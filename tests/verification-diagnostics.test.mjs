/**
 * 使用真实 Node 子进程验证异步验收和公开诊断边界。故意把标记写入响应、断言值、
 * 控制台、动态名称及错误对象，确认私有日志完整而公开 JSON 不含这些内容。
 * 不连接数据库、不启动应用；只创建并清理本测试拥有的随机临时目录。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runVerificationProcess } from "../scripts/verification-process.mjs";
import {
  apiDiagnosticReporterOptions,
  publicApiFailureDiagnostic,
} from "./support/api-test-diagnostics.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canary = "CANARY_PRIVATE_TOKEN_USER_SQL_8fe3c9";

/** 删除前校验已解析路径位于创建时选定的临时根目录内，绝不接受外部清理路径。 */
async function temporary(work) {
  const base = resolve(tmpdir());
  const directory = mkdtempSync(join(base, "mayday-verification-diagnostic-"));
  try {
    return await work(directory);
  } finally {
    assert.equal(dirname(resolve(directory)), base);
    assert.match(
      directory.slice(base.length),
      /^[\\/]mayday-verification-diagnostic-[a-zA-Z0-9_-]+$/,
    );
    rmSync(directory, { recursive: true, force: true });
  }
}

test("长验收保持父进程定时器运行，完整私有输出和非零退出码不被重试", async () => {
  await temporary(async (directory) => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    let response;
    try {
      response = await runVerificationProcess(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'process.stdout.write(process.env.CANARY); process.stderr.write("private-error"); setTimeout(() => process.exit(7), 160);',
        ],
        {
          cwd: directory,
          env: { ...process.env, CANARY: canary },
          logPath: join(directory, "private.log"),
          timeoutMs: 5000,
        },
      );
    } finally {
      clearInterval(timer);
    }
    assert(ticks >= 3, "长命令不应阻塞父进程事件循环");
    assert.equal(response.status, 7);
    assert.equal(response.error, undefined);
    assert.equal(response.stdout, canary);
    assert.equal(response.stderr, "private-error");
    const privateLog = readFileSync(join(directory, "private.log"), "utf8");
    assert(privateLog.includes(canary));
    assert(privateLog.includes("private-error"));
  });
});

test("真实双 reporter 仅公开静态失败名称与断言枚举，动态名称和断言正文不泄露", async () => {
  await temporary(async (directory) => {
    mkdirSync(join(directory, "tests"));
    const testFile = "tests/canary.test.mjs";
    writeFileSync(
      join(directory, testFile),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'test("固定的权限断言失败", () => {',
        "  console.log(process.env.CANARY);",
        '  assert.deepEqual({user: process.env.CANARY}, {user: "other"}, process.env.CANARY);',
        "});",
        "test(`动态_${process.env.CANARY}`, () => assert.fail(process.env.CANARY));",
      ].join("\n"),
    );
    const reportPath = join(directory, "reporter.json");
    const options = apiDiagnosticReporterOptions({
      phase: "upgrade",
      testFiles: [testFile],
      reportPath,
    });
    // 独立 CLI 不继承当前 node:test 工作进程标记，避免 Node 把它当成现有 runner 的子测试。
    const childEnvironment = { ...process.env, ...options.env, CANARY: canary };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const response = await runVerificationProcess(
      process.execPath,
      ["--test", ...options.args, testFile],
      {
        cwd: directory,
        env: childEnvironment,
        logPath: join(directory, "private.log"),
        timeoutMs: 10000,
      },
    );
    assert.equal(response.status, 1);
    assert(
      readFileSync(join(directory, "private.log"), "utf8").includes(canary),
    );
    const diagnostic = publicApiFailureDiagnostic({
      phase: "upgrade",
      root: directory,
      testFiles: [testFile],
      response,
      reportPath,
    });
    assert.equal(diagnostic.phase, "upgrade");
    assert.equal(diagnostic.process.exitCode, 1);
    assert.equal(diagnostic.failures[0].testName, "固定的权限断言失败");
    assert.equal(diagnostic.failures[0].file, testFile);
    assert.equal(diagnostic.failures[0].assertion.code, "ERR_ASSERTION");
    assert.equal(diagnostic.failures[0].assertion.operator, "deepStrictEqual");
    assert.equal(diagnostic.unidentifiedFailures, 1);
    assert.equal(diagnostic.counts.tests, 2);
    assert.equal(diagnostic.counts.failed, 2);
    const published = JSON.stringify(diagnostic);
    for (const secret of [
      canary,
      "other",
      "message",
      "stack",
      "actual",
      "expected",
    ])
      assert.equal(published.includes(secret), false);
  });
});

test("父进程重建失败摘要拒绝伪造字段、越界文件、动态名称及未知错误枚举", async () => {
  await temporary(async (directory) => {
    mkdirSync(join(directory, "tests"));
    const testFile = "tests/canary.test.mjs";
    writeFileSync(join(directory, testFile), 'test("固定名称", () => {});');
    const reportPath = join(directory, "reporter.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        phase: canary,
        env: canary,
        failures: [
          {
            file: testFile,
            testName: "固定名称",
            line: 1,
            column: 2,
            message: canary,
            expected: canary,
            actual: canary,
            assertion: {
              code: "ERR_ASSERTION",
              failureType: "testCodeFailure",
              operator: canary,
              stack: canary,
            },
          },
          { file: "tests/../../.env", testName: canary },
          { file: testFile, testName: canary, line: canary },
        ],
        counts: { tests: 2, failed: 2, skipped: canary, token: canary },
      }),
    );
    const diagnostic = publicApiFailureDiagnostic({
      phase: "fresh",
      root: directory,
      testFiles: [testFile],
      response: {
        status: 1,
        signal: canary,
        error: { code: canary, message: canary, stack: canary },
      },
      reportPath,
    });
    assert.equal(diagnostic.phase, "fresh");
    assert.equal(diagnostic.failures.length, 2);
    assert.equal(diagnostic.failures[1].testName, undefined);
    assert.equal(diagnostic.failures[0].assertion.operator, undefined);
    assert.equal(diagnostic.process.errorCode, undefined);
    assert.equal(diagnostic.process.signal, undefined);
    assert.equal(diagnostic.counts.skipped, undefined);
    assert.equal(JSON.stringify(diagnostic).includes(canary), false);
  });
});

test("超时和缺失程序保留标准失败码，无 reporter 文件时仅公开阶段与进程状态", async () => {
  await temporary(async (directory) => {
    for (const [command, args, expectedCode] of [
      [process.execPath, ["-e", "setInterval(() => {}, 1000)"], "ETIMEDOUT"],
      [join(directory, "missing-" + canary), [], "ENOENT"],
    ]) {
      const response = await runVerificationProcess(command, args, {
        cwd: directory,
        env: process.env,
        logPath: join(directory, "private.log"),
        timeoutMs: 160,
      });
      assert.equal(response.error.code, expectedCode);
      const diagnostic = publicApiFailureDiagnostic({
        phase: "fresh",
        root: directory,
        testFiles: [],
        response,
        reportPath: join(directory, "missing.json"),
      });
      assert.equal(diagnostic.process.errorCode, expectedCode);
      assert.deepEqual(diagnostic.failures, []);
      assert.equal(JSON.stringify(diagnostic).includes(canary), false);
    }
  });
});

test("诊断路径和阶段拒绝非测试源码，CI 只上传公开失败 JSON 白名单", () => {
  for (const testFile of [".env", "tests/../.env", "/absolute.test.mjs"])
    assert.throws(
      () =>
        apiDiagnosticReporterOptions({
          phase: "upgrade",
          testFiles: [testFile],
          reportPath: "failure.json",
        }),
      /诊断阶段或测试路径不合法/,
    );
  assert.throws(
    () =>
      apiDiagnosticReporterOptions({
        phase: canary,
        testFiles: [],
        reportPath: "failure.json",
      }),
    /诊断阶段或测试路径不合法/,
  );
  const workflow = readFileSync(
    join(repository, ".github/workflows/quality.yml"),
    "utf8",
  );
  const uploaded = workflow.split("path: |")[1].split("if-no-files-found:")[0];
  assert(uploaded.includes(".local/baseline/**/api-*-failure.json"));
  assert.equal(/\*\*\/\*|\.log|reporter\.json|\.env/.test(uploaded), false);
});
