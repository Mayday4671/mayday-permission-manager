/** 发布门槛的纯文件/参数回归，只创建测试临时目录，不访问 Docker、数据库或业务服务。 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  clusterReportArgument,
  verifiedClusterReport,
  clusterReleaseChecks,
} from "../scripts/cluster-release-gate.mjs";

const jar = Buffer.from("owned-frozen-jar-test-fixture");
const sha = createHash("sha256").update(jar).digest("hex");
const run = "20261005120000000-a1b2c3";

/** 报告样本严格模拟正式十项结果；不通过减少检查数或伪造业务测试来放宽门禁。 */
function successfulReport(id = run) {
  const checks = clusterReleaseChecks.map((name) => ({
    name,
    status: "passed",
    elapsedMs: 1,
  }));
  Object.assign(checks[0], {
    secondInstanceRejected: true,
    originalInstanceHealthy: true,
  });
  Object.assign(checks[7], { concurrentClaims: 20, successfulLeaseOwners: 1 });
  Object.assign(checks[8], {
    rows: 30000,
    attempts: 2,
    firstConcurrentDownloads: 6,
    spoolLifecycle: "passed",
    hardKillDirectoryLockReleased: true,
    csvSha256: "b".repeat(64),
  });
  return {
    runId: id,
    project: "mayday-check-" + id,
    artifactSha256: sha,
    status: "passed",
    cleanupSucceeded: true,
    checks,
    startedAt: "2026-10-05T00:00:00.000Z",
    finishedAt: "2026-10-05T00:01:00.000Z",
  };
}

/** 每个用例使用独立临时根，删除前校验根路径仍是本次 mkdtemp 所创建的位置。 */
function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "mayday-cluster-gate-"));
  try {
    const directory = join(root, ".local", "cluster", run);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "runtime.jar"), jar);
    const reportPath = join(directory, "report.json");
    writeFileSync(reportPath, JSON.stringify(successfulReport()));
    body({ root, directory, reportPath });
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(root.includes("mayday-cluster-gate-"));
    rmSync(root, { recursive: true, force: true });
  }
}

test("明确报告参数及缺省搜索均支持，未知参数或缺少路径直接拒绝", () => {
  assert.equal(clusterReportArgument([]), undefined);
  assert.equal(
    clusterReportArgument(["--cluster-report", "report.json"]),
    "report.json",
  );
  assert.equal(
    clusterReportArgument(["--cluster-report=report.json"]),
    "report.json",
  );
  for (const args of [
    ["--cluster-report"],
    ["--cluster-report="],
    ["--other"],
    ["--cluster-report", "report.json", "extra"],
  ])
    assert.throws(() => clusterReportArgument(args));
});

test("本仓完整成功报告且真实运行副本为同SHA时才放行", () =>
  fixture(({ root, reportPath }) => {
    const explicit = verifiedClusterReport(root, sha, reportPath);
    assert.equal(explicit.path, reportPath);
    assert.equal(explicit.checks, 10);
    assert.deepEqual(verifiedClusterReport(root, sha), explicit);
  }));

test("失败、未清理、其他SHA、跨批次身份及未完成报告均不能作为门槛", () =>
  fixture(({ root, reportPath }) => {
    const updates = [
      { status: "failed" },
      { cleanupSucceeded: false },
      { cleanupSucceeded: "true" },
      { artifactSha256: "a".repeat(64) },
      { runId: "20261005120000000-a1b2c4" },
      { project: "mayday" },
      { finishedAt: null },
      { finishedAt: "2025-01-01T00:00:00.000Z" },
    ];
    for (const update of updates) {
      writeFileSync(
        reportPath,
        JSON.stringify({ ...successfulReport(), ...update }),
      );
      assert.throws(() => verifiedClusterReport(root, sha, reportPath));
      assert.throws(() => verifiedClusterReport(root, sha));
    }
  }));

test("少量或重复passed、未知检查以及缺少硬故障证明不能冒充完整回归", () =>
  fixture(({ root, reportPath }) => {
    const variants = [
      (record) => record.checks.pop(),
      (record) => record.checks.push(record.checks[0]),
      (record) => (record.checks[1] = record.checks[0]),
      (record) => (record.checks[1].name = "unknown-check"),
      (record) => (record.checks[1].status = "failed"),
      (record) => (record.checks[1].elapsedMs = -1),
      (record) => (record.checks[0].secondInstanceRejected = false),
      (record) => (record.checks[7].successfulLeaseOwners = 2),
      (record) => (record.checks[8].attempts = 1),
      (record) => (record.checks[8].firstConcurrentDownloads = 0),
      (record) => (record.checks[8].spoolLifecycle = "skipped"),
      (record) => (record.checks[8].hardKillDirectoryLockReleased = false),
    ];
    for (const change of variants) {
      const record = successfulReport();
      change(record);
      writeFileSync(reportPath, JSON.stringify(record));
      assert.throws(() => verifiedClusterReport(root, sha, reportPath));
    }
  }));

test("明确跨仓或任意JSON路径拒绝，不能悄悄改为自动找到的有效记录", () =>
  fixture(({ root, directory }) => {
    const outside = join(root, "other-repository", ".local", "cluster", run);
    mkdirSync(outside, { recursive: true });
    writeFileSync(
      join(outside, "report.json"),
      JSON.stringify(successfulReport()),
    );
    writeFileSync(
      join(directory, "another.json"),
      JSON.stringify(successfulReport()),
    );
    for (const path of [
      join(outside, "report.json"),
      join(directory, "another.json"),
    ])
      assert.throws(() => verifiedClusterReport(root, sha, path));
  }));

test("运行副本损坏或缺失即拒绝，不能只相信报告自称的SHA", () =>
  fixture(({ root, directory, reportPath }) => {
    writeFileSync(join(directory, "runtime.jar"), "different-jar");
    assert.throws(() => verifiedClusterReport(root, sha, reportPath));
    unlinkSync(join(directory, "runtime.jar"));
    assert.throws(() => verifiedClusterReport(root, sha, reportPath));
  }));

test("受控目录的符号链接或Windows联接不能读取仓库外报告", () =>
  fixture(({ root, directory }) => {
    const linkedRun = "20261005130000000-a1b2c4";
    const target = join(root, "external-report");
    mkdirSync(target);
    writeFileSync(
      join(target, "report.json"),
      JSON.stringify(successfulReport(linkedRun)),
    );
    writeFileSync(join(target, "runtime.jar"), jar);
    const linked = join(dirname(directory), linkedRun);
    symlinkSync(
      target,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    try {
      assert.throws(
        () => verifiedClusterReport(root, sha, join(linked, "report.json")),
        /符号链接或目录联接/,
      );
      assert.equal(verifiedClusterReport(root, sha).runId, run);
    } finally {
      unlinkSync(linked);
    }
  }));
