/**
 * 双 Java 实例与真实 MySQL 的集群验收入口。每轮创建随机项目、动态端口和独立数据卷，
 * 两节点使用不同文件目录；强制终止的仅是本脚本创建的子进程，不关闭日常服务。
 * 密码、验证码、会话和正文不输出到终端；结果只记录检查项、状态、计数和产物摘要。
 * 使用已构建 JAR，避免与其他验收并发写 Maven target：node scripts/verify-cluster.mjs [jar路径]。
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  copyFileSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import {
  javaRuntimeEnvironment,
  assertLocalDockerEndpoint,
} from "./runtime-environment.mjs";
import {
  challenge,
  puzzleOffset,
  captchaRequest,
  loginWithCaptcha,
  captchaToken,
} from "../tests/support/captcha.mjs";

// Unix上的隔离私有日志、随机环境和CSV样本只允许当前操作系统账号访问；Windows使用账号ACL。
process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId =
  new Date().toISOString().replace(/\D/g, "") +
  "-" +
  randomBytes(3).toString("hex");
const project = "mayday-check-" + runId;
const output = join(root, ".local", "cluster", runId);
mkdirSync(output, { recursive: true });
const password = "QA_" + randomBytes(24).toString("base64url") + "9!";
const environment = {
  ...process.env,
  VERIFY_DB_PASSWORD: randomBytes(24).toString("hex"),
  VERIFY_ADMIN_PASSWORD: password,
};
const sourceJar = resolve(
  root,
  process.argv[2] ?? ".local/full-integrated-qa.jar",
);
const jar = join(output, "runtime.jar");
copyFileSync(sourceJar, jar);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const report = {
  runId,
  project,
  artifactSha256: hash(readFileSync(jar)),
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
};
const composeFile = join(output, "compose.json");
const compose = [
  "compose",
  "--project-directory",
  root,
  "-p",
  project,
  "-f",
  join(root, "compose.verify.yaml"),
  "-f",
  composeFile,
];
const children = new Map();
const streams = [];
let created = false;
let sequence = 0;
let baseA, baseB, databasePort, runProbe;

/** 参数数组及标准输入避免 shell 插值；数据库口令仅通过进程环境继承，不放入命令参数。 */
function command(
  executable,
  args,
  { input, log, allowFailure = false, env = environment, cwd = root } = {},
) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240000,
  });
  if (log)
    writeFileSync(
      join(output, log),
      (result.stdout ?? "") + (result.stderr ?? ""),
    );
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error("隔离验收子进程失败：" + (log ?? executable));
  return result;
}

/** SQL 只对脚本创建的随机项目执行；不接受外部数据库名或日常项目参数。 */
function sql(statement) {
  assert(created && /^mayday-check-\d+-[a-f0-9]{6}$/.test(project));
  return command(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "fresh-db",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --skip-column-names',
    ],
    { input: statement },
  ).stdout.trim();
}

/** 本机动态选择空闲端口，避免硬占其他验收项目；启动期间若被占用则明确失败。 */
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

async function until(check, timeout = 30000, message = "隔离服务状态等待超时") {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

/** 页面 API 与真实服务相同；失败报告不拼接响应正文，防止泄露认证或业务数据。 */
async function api(
  base,
  path,
  token,
  method = "GET",
  body,
  expected = 200,
  key,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${method} ${path} 状态不符`);
  const content = await response.json();
  assert.equal(content.success, expected < 400);
  return content.data;
}

/** 只跟踪本轮 spawn 的 Java 句柄。硬故障通过 SIGKILL 模拟，不执行按端口或映像名批量杀进程。 */
async function start(name, port, workers, options = {}) {
  assert(!children.has(name));
  const directory = join(output, name);
  mkdirSync(directory, { recursive: true });
  const logFile = join(output, `${name}-${++sequence}.log`);
  const handle = openSync(logFile, "a");
  const spoolDirectory = options.spoolDirectory ?? join(directory, "bulk");
  assert(
    resolve(spoolDirectory).startsWith(
      output + (process.platform === "win32" ? "\\" : "/"),
    ),
    "不是本轮自有缓存目录",
  );
  const java = environment.JAVA_HOME
    ? join(
        environment.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      )
    : "java";
  const child = spawn(
    java,
    [
      "-Xms96m",
      "-Xmx512m",
      "-jar",
      jar,
      "--spring.config.location=classpath:/application.yml",
      `--server.port=${port}`,
      `--mayday.bulk.workers-enabled=${workers}`,
      `--mayday.bulk.spool-directory=${spoolDirectory}`,
    ],
    {
      cwd: root,
      windowsHide: true,
      env: javaRuntimeEnvironment(environment, {
        DB_URL: `jdbc:mysql://127.0.0.1:${databasePort}/mayday_verify?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
        DB_USERNAME: "mayday_verify",
        DB_PASSWORD: environment.VERIFY_DB_PASSWORD,
        ADMIN_PASSWORD: password,
        SEED_DEMO_DATA: "false",
        MODULE_UDP_ENABLED: "false",
        MODULE_CRAWLER_ENABLED: "false",
        MAYDAY_STORAGE_MODE: "LOCAL",
        MAYDAY_STORAGE_LOCAL_ROOT: join(directory, "files"),
        MAYDAY_MFA_ENABLED: "false",
        MAYDAY_TASKS_LEASESECONDS: "15",
      }),
      stdio: ["ignore", handle, handle],
    },
  );
  closeSync(handle);
  children.set(name, child);
  child.once("error", () => {
    if (children.get(name) === child) children.delete(name);
  });
  child.once("exit", () => {
    if (children.get(name) === child) children.delete(name);
  });
  if (options.expectSpoolRejection) {
    await until(
      () => !children.has(name),
      120000,
      "共享目录的第二实例未拒绝启动",
    );
    assert(
      Number.isInteger(child.exitCode) && child.exitCode !== 0,
      "共享spool实例没有明确失败退出",
    );
    assert.match(readFileSync(logFile, "utf8"), /批量作业缓存目录不可安全独占/);
    return null;
  }
  const base = `http://127.0.0.1:${port}/api`;
  await until(
    async () => {
      assert(children.has(name), "本轮 Java 实例提前退出，请查看私有验收日志");
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/actuator/health`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok;
      } catch {
        return false;
      }
    },
    120000,
    "Java 健康检查超时",
  );
  return base;
}

async function stop(name) {
  const child = children.get(name);
  if (!child) return;
  const exited = new Promise((ok) => child.once("exit", ok));
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    delay(15000).then(() => {
      throw new Error("自有 Java 子进程未退出");
    }),
  ]);
  children.delete(name);
}

/** SSE 保存最小资源提示；每个读取器有独立中止句柄，关闭后等服务端精确释放共享登记。 */
async function stream(base, token) {
  const controller = new AbortController();
  const response = await fetch(base + "/operations/realtime/stream", {
    headers: { Authorization: "Bearer " + token },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/event-stream/);
  const events = [];
  let closed = false;
  void (async () => {
    const reader = response.body.getReader(),
      decode = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decode.decode(value, { stream: true });
        const parts = pending.replace(/\r\n/g, "\n").split("\n\n");
        pending = parts.pop() ?? "";
        for (const part of parts) {
          const event = part.match(/^event:\s*(.*)$/m)?.[1],
            data = part.match(/^data:\s*(.*)$/m)?.[1];
          if (event && data) events.push({ event, ...JSON.parse(data) });
        }
      }
    } catch {
      /* 正常关闭、实例故障或会话撤销均结束当前读取器。 */
    } finally {
      closed = true;
    }
  })();
  const connection = {
    events,
    close: () => controller.abort(),
    closed: () => closed,
  };
  streams.push(connection);
  await until(() => events.some((item) => item.event === "ready"));
  return connection;
}

/** 每个完成项先断言真实结果再记录通过，失败不会被写成绿色的最终验收。 */
async function check(name, work) {
  const begun = Date.now();
  const detail = await work();
  report.checks.push({
    name,
    status: "passed",
    elapsedMs: Date.now() - begun,
    ...(detail ?? {}),
  });
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`PASS ${name}\n`);
}

async function completed(base, id, token, timeout = 180000) {
  let view;
  await until(
    async () => {
      view = await api(base, `/bulk/jobs/${id}`, token);
      assert(
        !["FAILED", "CANCELLED"].includes(view.status),
        "导出进入失败终态",
      );
      return view.status === "SUCCEEDED";
    },
    timeout,
    "恢复导出等待超时",
  );
  return view;
}

async function download(base, id, token) {
  const response = await fetch(base + `/bulk/jobs/${id}/download`, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

try {
  assertLocalDockerEndpoint(environment);
  databasePort = await freePort();
  const portA = await freePort(),
    portB = await freePort();
  assert.equal(new Set([databasePort, portA, portB]).size, 3);
  writeFileSync(
    composeFile,
    JSON.stringify({
      services: { "fresh-db": { ports: [`127.0.0.1:${databasePort}:3306`] } },
    }),
  );
  created = true;
  command(
    "docker",
    [...compose, "up", "-d", "--wait", "--wait-timeout", "150", "fresh-db"],
    { log: "database.log" },
  );
  baseA = await start("a", portA, true);
  baseB = await start("b", portB, false);
  await check(
    "同一spool第二实例拒启，避免并发重建与清理绕过本实例保护",
    async () => {
      let portC = await freePort();
      while ([portA, portB, databasePort].includes(portC))
        portC = await freePort();
      await start("rejected", portC, false, {
        spoolDirectory: join(output, "a", "bulk"),
        expectSpoolRejection: true,
      });
      assert(
        (await fetch(baseA.replace(/\/api$/, "/actuator/health"))).ok,
        "目录冲突影响了原实例",
      );
      return { secondInstanceRejected: true, originalInstanceHealthy: true };
    },
  );
  let tokenA, tokenB;
  await check("验证码跨节点验证、登录和一次性消费", async () => {
    const puzzle = await challenge(baseA, "admin");
    await delay(350);
    const data = {
      challengeId: puzzle.challengeId,
      username: "admin",
      x: puzzleOffset(puzzle),
      elapsedMs: 350,
    };
    const proof = (await captchaRequest(baseB, "/auth/captcha/verify", data))
      .captchaToken;
    await captchaRequest(baseA, "/auth/captcha/verify", data, 400);
    tokenA = (
      await captchaRequest(baseA, "/auth/login", {
        username: "admin",
        password,
        captchaToken: proof,
      })
    ).token;
    assert(tokenA);
    await captchaRequest(
      baseB,
      "/auth/login",
      { username: "admin", password, captchaToken: proof },
      400,
    );
    tokenB = (await loginWithCaptcha(baseB, "admin", password)).token;
    assert.equal((await api(baseB, "/auth/me", tokenA)).user.username, "admin");
    assert.equal(
      sql(
        "select count(*) from sys_security_state where length(token_key)<>64 or token_key not regexp '^[a-f0-9]{64}$'",
      ),
      "0",
    );
  });
  await check("登录失败窗口跨节点共享并在实例重启后保留", async () => {
    const account = "missing_" + randomBytes(4).toString("hex");
    for (let attempt = 0; attempt < 5; attempt++)
      await loginWithCaptcha(
        attempt % 2 ? baseA : baseB,
        account,
        password,
        401,
      );
    const proof = await captchaToken(baseA, account);
    await captchaRequest(
      baseB,
      "/auth/login",
      { username: account, password, captchaToken: proof },
      429,
    );
    await stop("b");
    baseB = await start("b", portB, false);
    await captchaRequest(
      baseB,
      "/auth/login",
      { username: account, password, captchaToken: proof },
      429,
    );
    assert.equal(
      sql(
        `select attempts from sys_security_rate where rate_key='${hash("login-account:127.0.0.1\n" + account)}'`,
      ),
      "5",
    );
  });
  await check("参数更新在其他节点立即可见，无本机缓存残留", async () => {
    const settings = await api(baseA, "/system/site-config", tokenA);
    const name = settings.entries.find((item) => item.code === "site.name");
    const value = "QA Cluster " + randomBytes(4).toString("hex");
    await api(baseA, "/system/site-config", tokenA, "PUT", {
      "site.name": { value, version: name.version },
    });
    assert.equal((await api(baseB, "/public/site")).name, value);
  });
  await check("双节点 SSE 投递、全局账号配额及撤销会话断流", async () => {
    const first = await stream(baseB, tokenB);
    const userId = (await api(baseA, "/auth/me", tokenA)).user.id;
    const notification = await api(
      baseA,
      "/operations/notifications",
      tokenA,
      "POST",
      {
        title: "集群提交验收",
        summary: "隔离测试",
        content: "<p>提交后刷新</p>",
        type: "NOTICE",
        recipientType: "USERS",
        recipientIds: [userId],
        attachmentIds: [],
      },
    );
    await api(
      baseA,
      `/operations/notifications/${notification.id}/publish`,
      tokenA,
      "POST",
      { version: notification.version },
    );
    await until(() =>
      first.events.some(
        (item) => item.event === "changed" && item.topics.includes("messages"),
      ),
    );
    const others = [
      await stream(baseA, tokenA),
      await stream(baseB, tokenB),
      await stream(baseA, tokenA),
    ];
    await api(
      baseB,
      "/operations/realtime/stream",
      tokenB,
      "GET",
      undefined,
      400,
    );
    assert.equal(
      sql(
        `select count(*) from sys_realtime_connection where user_id=${userId}`,
      ),
      "4",
    );
    const before = sql("select count(*) from sys_realtime_event");
    sql(
      `start transaction; insert into sys_realtime_event(recipient_id,topics,created_at) values(${userId},'messages',current_timestamp(3)); rollback;`,
    );
    assert.equal(sql("select count(*) from sys_realtime_event"), before);
    others.forEach((connection) => connection.close());
    await api(baseA, "/auth/logout", tokenB, "POST");
    await until(() => first.closed(), 20000, "撤销会话后其他实例没有断流");
    await until(
      () =>
        sql(
          `select count(*) from sys_realtime_connection where user_id=${userId}`,
        ) === "0",
      40000,
    );
    tokenB = (await loginWithCaptcha(baseB, "admin", password)).token;
    return { committedRefreshes: Number(before) };
  });
  await check("手动调度跨实例并发重试只有一个执行记录", async () => {
    const job = await api(baseA, "/operations/scheduler", tokenA, "POST", {
      name: "集群幂等检查",
      handler: "DATABASE_CHECK",
      cron: "0 */5 * * * *",
      enabled: false,
    });
    const key = randomUUID();
    const results = await Promise.all([
      api(
        baseA,
        `/operations/scheduler/${job.id}/run`,
        tokenA,
        "POST",
        undefined,
        200,
        key,
      ),
      api(
        baseB,
        `/operations/scheduler/${job.id}/run`,
        tokenB,
        "POST",
        undefined,
        200,
        key,
      ),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(
      sql(`select count(*) from ops_job_execution where job_id=${job.id}`),
      "1",
    );
    await until(
      () =>
        sql(`select status from ops_job_execution where job_id=${job.id}`) ===
        "SUCCESS",
    );
    assert.equal(
      sql(`select attempts from ops_job_execution where job_id=${job.id}`),
      "1",
    );
    await api(baseB, `/operations/scheduler/${job.id}`, tokenB, "DELETE");
  });
  await check("导出作业跨节点幂等、独立文件目录下载一致", async () => {
    const key = randomUUID(),
      filter = { keyword: "", enabled: null, departmentId: null };
    const [one, two] = await Promise.all([
      api(baseA, "/bulk/users/exports", tokenA, "POST", filter, 200, key),
      api(baseB, "/bulk/users/exports", tokenB, "POST", filter, 200, key),
    ]);
    assert.equal(one.id, two.id);
    await completed(baseA, one.id, tokenA);
    const bodyA = await download(baseA, one.id, tokenA),
      bodyB = await download(baseB, one.id, tokenB);
    assert.equal(hash(bodyA), hash(bodyB));
    assert.equal(
      sql(`select count(*) from sys_bulk_result where job_id=${one.id}`),
      "1",
    );
    return { resultSha256: hash(bodyA) };
  });
  await check(
    "交付JAR真实MySQL租约隔离、原子提交、重试取消及20路竞争",
    async () => {
      const extracted = join(output, "extracted"),
        classes = join(output, "probe");
      mkdirSync(extracted, { recursive: true });
      mkdirSync(classes, { recursive: true });
      const executable = (name) =>
        environment.JAVA_HOME
          ? join(
              environment.JAVA_HOME,
              "bin",
              name + (process.platform === "win32" ? ".exe" : ""),
            )
          : name;
      command(
        executable("jar"),
        ["xf", jar, "BOOT-INF/classes", "BOOT-INF/lib"],
        {
          cwd: extracted,
          log: "probe-extract.log",
          env: javaRuntimeEnvironment(environment, {}),
        },
      );
      const separator = process.platform === "win32" ? ";" : ":";
      const classpath = [
        join(extracted, "BOOT-INF", "classes"),
        join(extracted, "BOOT-INF", "lib", "*"),
      ].join(separator);
      command(
        executable("javac"),
        [
          "--release",
          "21",
          "-encoding",
          "UTF-8",
          "-cp",
          classpath,
          "-d",
          classes,
          join(root, "tests", "java", "ClusterPersistenceProbe.java"),
        ],
        {
          log: "probe-compile.log",
          env: javaRuntimeEnvironment(environment, {}),
        },
      );
      runProbe = (mode, extra = {}) =>
        command(
          executable("java"),
          [
            "-cp",
            classes + separator + classpath,
            "ClusterPersistenceProbe",
            ...(mode ? [mode] : []),
          ],
          {
            log: mode ? `probe-${mode}.log` : "probe.log",
            env: javaRuntimeEnvironment(environment, {
              CLUSTER_TEST_PROJECT: project,
              DB_URL: `jdbc:mysql://127.0.0.1:${databasePort}/mayday_verify?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
              DB_USERNAME: "mayday_verify",
              DB_PASSWORD: environment.VERIFY_DB_PASSWORD,
              CLUSTER_TEST_SPOOL: extra.CLUSTER_TEST_SPOOL,
              CLUSTER_TEST_RESIDUE: extra.CLUSTER_TEST_RESIDUE,
              CLUSTER_TEST_RESULT_KEY: extra.CLUSTER_TEST_RESULT_KEY,
            }),
          },
        );
      const response = runProbe();
      assert.equal((response.stdout.match(/^PASS /gm) ?? []).length, 3);
      return { concurrentClaims: 20, successfulLeaseOwners: 1 };
    },
  );
  await check(
    "运行中硬故障、心跳与环境租约配置、另一节点恢复完整单份 CSV",
    async () => {
      // 测试人员只在本轮随机空库生成；复制该隔离管理员已有散列，不用固定口令或日常账号数据。
      sql(
        "create table qa_cluster_digits(n int); insert into qa_cluster_digits values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9); insert into sys_user(username,password_hash,nickname,enabled,created_at,updated_at,version) select concat('qa_bulk_',lpad(x.n,5,'0')),u.password_hash,concat('人员',x.n),1,current_timestamp(6),current_timestamp(6),0 from (select a.n+10*b.n+100*c.n+1000*d.n+10000*e.n n from qa_cluster_digits a cross join qa_cluster_digits b cross join qa_cluster_digits c cross join qa_cluster_digits d cross join qa_cluster_digits e) x cross join sys_user u where u.username='admin' and x.n<30000; drop table qa_cluster_digits;",
      );
      const job = await api(
        baseA,
        "/bulk/users/exports",
        tokenA,
        "POST",
        { keyword: "qa_bulk_", enabled: null, departmentId: null },
        200,
        randomUUID(),
      );
      await until(
        () =>
          sql(
            `select status from sys_durable_task where task_type='BULK_EXPORT' and business_key='${job.id}'`,
          ) === "RUNNING",
      );
      assert.equal(
        sql(
          `select lease_until-heartbeat_at from sys_durable_task where task_type='BULK_EXPORT' and business_key='${job.id}'`,
        ),
        "15000",
        "MAYDAY_TASKS_LEASESECONDS 没有绑定到15秒",
      );
      const oldToken = sql(
        `select lease_token from sys_durable_task where task_type='BULK_EXPORT' and business_key='${job.id}'`,
      );
      assert.match(oldToken, /^[a-f0-9-]{36}$/);
      const resultKey = sql(
        `select result_key from sys_bulk_job where id=${job.id}`,
      );
      assert.match(resultKey, /^[a-f0-9-]{36}$/);
      const residueName = `${resultKey}-${oldToken}.part`;
      const residue = join(output, "a", "bulk", residueName);
      // 强杀必须发生在真正写出部分正文后，不用空文件或人工制造残留冒充进程故障证据。
      await until(
        () =>
          existsSync(residue) &&
          statSync(residue).size > 0 &&
          Number(
            sql(`select processed_rows from sys_bulk_job where id=${job.id}`),
          ) > 0,
      );
      await stop("a");
      assert(existsSync(residue), "硬故障未留下本租约部分输出");
      await stop("b");
      baseB = await start("b", portB, true);
      const done = await completed(baseB, job.id, tokenB);
      assert.equal(done.processedRows, 30000);
      const queue = sql(
        `select status,attempts from sys_durable_task where task_type='BULK_EXPORT' and business_key='${job.id}'`,
      ).split("\t");
      assert.deepEqual(queue, ["SUCCEEDED", "2"]);
      assert.equal(
        sql(`select count(*) from sys_bulk_result where job_id=${job.id}`),
        "1",
      );
      assert.equal(
        sql(
          `select count(*) from sys_durable_task where task_type='BULK_EXPORT' and business_key='${job.id}' and lease_token='${oldToken}'`,
        ),
        "0",
      );
      const body = await download(baseB, job.id, tokenB);
      const usernames = body
        .toString("utf8")
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean)
        .map((row) => row.split(",")[0].replace(/^"|"$/g, ""));
      assert.equal(usernames.length, 30000);
      assert.equal(new Set(usernames).size, 30000);
      baseA = await start("a", portA, false);
      const simultaneous = await Promise.all(
        Array.from({ length: 6 }, () => download(baseA, job.id, tokenA)),
      );
      for (const value of simultaneous)
        assert.equal(hash(value), hash(body), "并发首次下载得到不完整缓存");
      // 生命周期探针作为本目录下一任拥有者获取真正排他锁；不会在运行中的A实例旁越过目录锁清理。
      await stop("a");
      const lifecycle = runProbe("spool", {
        CLUSTER_TEST_SPOOL: join(output, "a", "bulk"),
        CLUSTER_TEST_RESIDUE: residueName,
        CLUSTER_TEST_RESULT_KEY: resultKey,
      });
      assert.equal((lifecycle.stdout.match(/^PASS /gm) ?? []).length, 1);
      assert(!existsSync(residue), "实际硬杀残留仍未回收");
      baseA = await start("a", portA, false);
      return {
        rows: done.processedRows,
        attempts: 2,
        csvSha256: hash(body),
        firstConcurrentDownloads: 6,
        spoolLifecycle: "passed",
        hardKillDirectoryLockReleased: true,
        symbolicLinkCheck: lifecycle.stdout.includes("symbolic-link=checked")
          ? "passed"
          : "skipped-permission",
      };
    },
  );
  // 最后使用同一随机库跑日常单节点控制回归，包含取消、恢复、下载权限和调度终态操作限制。
  await check("正式持久任务 API 回归", async () => {
    const result = command(
      process.execPath,
      ["--test", "--test-reporter=tap", "tests/shared-execution.test.mjs"],
      {
        log: "shared-execution.log",
        allowFailure: true,
        env: {
          ...environment,
          API_BASE: baseB,
          API_TEST_COMPOSE_PROJECT: project,
          API_TEST_DATABASE: "fresh-db",
          ADMIN_PASSWORD: password,
          MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(compose),
          API_TEST_NATIVE_FILES: "",
        },
      },
    );
    // 该文件默认要求显式隔离变量，子进程单独注入，不能用未启用测试的 skip 冒充通过。
    assert.equal(result.status, 0);
    assert.match(result.stdout, /# skipped 0/);
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.message;
  process.stderr.write("FAIL " + error.message + "\n");
  process.exitCode = 1;
} finally {
  streams.forEach((connection) => connection.close());
  for (const name of [...children.keys()]) {
    try {
      await stop(name);
    } catch {
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  if (created) {
    const cleanup = command(
      "docker",
      [...compose, "down", "--volumes", "--remove-orphans"],
      {
        log: "cleanup.log",
        allowFailure: true,
      },
    );
    report.cleanupSucceeded = !cleanup.error && cleanup.status === 0;
    if (!report.cleanupSucceeded) {
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`报告：${join(output, "report.json")}\n`);
}
