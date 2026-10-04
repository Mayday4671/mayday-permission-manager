/**
 * 企业部署验收：仅使用基线脚本创建的随机隔离项目和独立临时库。
 * 真实验证安全配置拒绝、健康探针与DDL/DML账号分离；不调用日常数据库或打印凭据。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

const project = process.env.API_TEST_COMPOSE_PROJECT;
assert.match(project ?? "", /^mayday-check-\d+-[a-f0-9]{6}$/);
const container = `${project}-production-check`;
const database = "mayday_production_verify";
const runtimeUser = "mayday_runtime_verify";
const runtimePassword = randomBytes(24).toString("hex");
const adminPassword = randomBytes(24).toString("hex");
const compose = ["compose", "-p", project, "-f", "compose.verify.yaml"];
const port = process.env.VERIFY_PRODUCTION_PORT ?? "18086";
assert.match(port, /^\d{4,5}$/);

function docker(args, input, allowFailure = false) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure)
    assert(result.status === 0 && !result.error, "隔离生产检查命令失败");
  return result.stdout ?? "";
}
function sql(statement) {
  return docker(
    [
      ...compose,
      "exec",
      "-T",
      "fresh-db",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch --skip-column-names',
    ],
    statement,
  ).trim();
}
function removeContainer() {
  docker(["rm", "-f", container], undefined, true);
}
/** 区分真实HTTP拒绝与连接失败；不能把空响应误当成接口已关闭。 */
function rejectedHttp(path, status) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "wget",
      "-T",
      "15",
      "-S",
      "-O",
      "/dev/null",
      `http://127.0.0.1:8080${path}`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20000 },
  );
  assert.equal(result.status, 1, "预期HTTP拒绝未出现");
  assert.match(
    result.stderr,
    new RegExp(`HTTP/1\\.[01] ${status}\\b`),
    "连接错误不能计为有效HTTP拒绝",
  );
}
function start(environment) {
  docker([
    ...compose,
    "run",
    "--no-deps",
    "-d",
    "--name",
    container,
    "-p",
    `127.0.0.1:${port}:8080`,
    ...Object.entries(environment).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]),
    "backend-fresh",
  ]);
}
async function ready() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const result = docker(
      [
        "exec",
        container,
        "wget",
        "-qO-",
        "http://127.0.0.1:8080/actuator/health/readiness",
      ],
      undefined,
      true,
    );
    if (result.includes('"status":"UP"')) return;
    const state = docker([
      "inspect",
      "--format",
      "{{.State.Status}}",
      container,
    ]).trim();
    assert.notEqual(state, "exited", "生产实例未能启动");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("生产实例readiness等待超时");
}

let createdDatabase = false;
let databaseStopped = false;
try {
  // 预置独立空库，由迁移账号完成DDL；实际运行账号随后仅授予四种DML操作。
  sql(
    `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL ON ${database}.* TO 'mayday_verify'@'%'; CREATE USER '${runtimeUser}'@'%' IDENTIFIED BY '${runtimePassword}'; GRANT SELECT,INSERT,UPDATE,DELETE ON ${database}.* TO '${runtimeUser}'@'%';`,
  );
  createdDatabase = true;
  const secure = {
    DB_URL: `jdbc:mysql://fresh-db:3306/${database}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
    MAYDAY_PRODUCTION: "true",
    MAYDAY_PUBLIC_ORIGIN: "https://portal.example.invalid",
    ADMIN_PASSWORD: adminPassword,
    API_DOCS_ENABLED: "false",
    SEED_DEMO_DATA: "false",
  };
  start({ ...secure, ADMIN_PASSWORD: "Mayday@2026" });
  const deadline = Date.now() + 60000;
  let exited = false;
  while (Date.now() < deadline) {
    exited =
      docker(["inspect", "--format", "{{.State.Status}}", container]).trim() ===
      "exited";
    if (exited) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(exited, "不安全生产配置没有拒绝启动");
  const logs = docker(["logs", container]);
  assert(
    logs.includes("生产启动检查未通过") && logs.includes("ADMIN_PASSWORD"),
  );
  assert(
    !logs.includes(adminPassword) && !logs.includes(runtimePassword),
    "启动日志泄露凭据",
  );
  console.log("通过：生产实例拒绝示例密码且不输出凭据");
  removeContainer();
  start(secure);
  await ready();
  for (const group of ["liveness", "readiness"]) {
    const health = JSON.parse(
      docker([
        "exec",
        container,
        "wget",
        "-qO-",
        `http://127.0.0.1:8080/actuator/health/${group}`,
      ]),
    );
    assert.equal(health.status, "UP");
    assert(!health.components, "匿名探针暴露内部组件详情");
  }
  assert.equal(sql(`SELECT COUNT(*) FROM ${database}.sys_user;`), "1");
  assert.equal(sql(`SELECT COUNT(*) FROM ${database}.cms_notice;`), "0");
  const token = (
    await loginWithCaptcha(
      `http://127.0.0.1:${port}/api`,
      "admin",
      adminPassword,
    )
  ).token;
  const contract = await fetch(
    `http://127.0.0.1:${port}/api/platform/openapi`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    },
  );
  assert.equal(contract.status, 404, "关闭契约必须对有效管理员真实返回404");
  console.log("通过：安全配置真实启动、纯净初始化及匿名探针通过");
  removeContainer();
  start({
    ...secure,
    DB_USERNAME: runtimeUser,
    DB_PASSWORD: runtimePassword,
    DB_MIGRATIONS_ENABLED: "false",
  });
  await ready();
  const privileges = sql(`SHOW GRANTS FOR '${runtimeUser}'@'%';`);
  assert(privileges.includes("SELECT, INSERT, UPDATE, DELETE"));
  assert(!/CREATE|ALTER|DROP|ALL PRIVILEGES/.test(privileges));
  assert.equal(sql(`SELECT COUNT(*) FROM ${database}.sys_user;`), "1");
  console.log("通过：关闭自动迁移后仅DML权限账号正常运行，重启不重复初始化");
  docker([...compose, "stop", "fresh-db"]);
  databaseStopped = true;
  const live = JSON.parse(
    docker([
      "exec",
      container,
      "wget",
      "-qO-",
      "http://127.0.0.1:8080/actuator/health/liveness",
    ]),
  );
  assert.equal(live.status, "UP");
  rejectedHttp("/actuator/health/readiness", 503);
  console.log("通过：数据库中断时liveness保留UP、readiness返回503");
} finally {
  removeContainer();
  if (databaseStopped)
    docker([
      ...compose,
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "180",
      "fresh-db",
    ]);
  if (createdDatabase)
    sql(`DROP DATABASE ${database}; DROP USER '${runtimeUser}'@'%';`);
}
