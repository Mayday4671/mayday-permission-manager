/**
 * Windows/本机 Java 的真实交付验收：原库只读备份，随机隔离 MySQL 验证三种安装路径。
 * 默认重新构建 Java，复制运行产物，避免占用 Maven target；不删除日常卷或关闭其他服务。
 * 日志/口令/业务备份只保留在 .local，终端只显示检查名称和结果；不冒充容器镜像验收。
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  openSync,
  closeSync,
  existsSync,
  statSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import {
  deploymentFingerprint,
  assertVerifiedInputs,
} from "./deployment-inputs.mjs";
import {
  readDatabaseMetadata,
  readDatabaseConstraints,
  verifyDatabaseComments,
  structuralColumns,
} from "./database-docs.mjs";
import {
  snapshotJsonFields,
  preservedBusinessColumns,
  readCrawlerMenu,
  verifyCrawlerMenuRename,
} from "./migration-snapshot.mjs";
import { fileManifest } from "./file-backup.mjs";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";
import {
  isolatedSql,
  isolatedApiEnvironment,
} from "../tests/support/isolated-compose.mjs";
import { verifyIdentityRestart } from "../tests/support/identity-restart.mjs";
import { verifyIdentityRace } from "./verify-identity-race.mjs";
import { runVerificationProcess } from "./verification-process.mjs";
import {
  publicBusinessTimeFailure,
  verifyBusinessTime,
} from "./verify-business-time.mjs";
import {
  apiDiagnosticReporterOptions,
  publicApiFailureDiagnostic,
} from "../tests/support/api-test-diagnostics.mjs";
import {
  javaRuntimeEnvironment,
  assertLocalDockerEndpoint,
} from "./runtime-environment.mjs";
import {
  moduleProfiles,
  verifyModuleProfile,
} from "./module-switch-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 私有验收数据不向同机其他 Unix 用户开放；Windows 使用当前用户受控目录与 ACL。
process.umask(0o077);
assertLocalDockerEndpoint();
const runId =
  new Date().toISOString().replace(/\D/g, "") +
  "-" +
  randomBytes(3).toString("hex");
const project = "mayday-check-" + runId;
const output = join(root, ".local", "baseline", runId);
mkdirSync(output, { recursive: true });
const settings = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [
        line.slice(0, at),
        line
          .slice(at + 1)
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2"),
      ];
    }),
);
assert(settings.ADMIN_PASSWORD, "需配置 ADMIN_PASSWORD，不使用固定管理员口令");
const environment = {
  ...process.env,
  VERIFY_DB_PASSWORD: randomBytes(24).toString("hex"),
  VERIFY_ADMIN_PASSWORD: settings.ADMIN_PASSWORD,
};
// 身份协议只连接本机专用提供方；每轮独立加密密钥，测试身份与日常配置完全分离。
const identityEnvironment = {
  MAYDAY_MFA_ENABLED: "true",
  MAYDAY_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MAYDAY_IDENTITY_LABEL: "Mayday QA",
  MAYDAY_IDENTITY_PROVIDERS_0_ID: "qa-identity",
  MAYDAY_IDENTITY_PROVIDERS_0_NAME: "QA企业身份",
  MAYDAY_IDENTITY_PROVIDERS_0_ISSUER: "http://127.0.0.1:18390",
  MAYDAY_IDENTITY_PROVIDERS_0_CLIENTID: "mayday-qa",
  MAYDAY_IDENTITY_PROVIDERS_0_CLIENTSECRET: randomBytes(24).toString("hex"),
  MAYDAY_IDENTITY_PROVIDERS_0_AUTHORIZATIONURI:
    "http://127.0.0.1:18390/authorize",
  MAYDAY_IDENTITY_PROVIDERS_0_TOKENURI: "http://127.0.0.1:18390/token",
  MAYDAY_IDENTITY_PROVIDERS_0_JWKSURI: "http://127.0.0.1:18390/jwks",
  MAYDAY_IDENTITY_PROVIDERS_0_REDIRECTURI:
    "http://127.0.0.1:15174/auth/oidc/callback",
  MAYDAY_IDENTITY_PROVIDERS_0_CLIENTAUTHENTICATION: "client_secret_basic",
  MAYDAY_IDENTITY_PROVIDERS_0_ENABLED: "true",
};
const java = environment.JAVA_HOME
  ? join(
      environment.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const sourceCompose = [
  "compose",
  "--project-directory",
  root,
  "-f",
  join(root, "compose.yaml"),
];
const override = join(output, "native-compose.json");
const checkCompose = [
  "compose",
  "--project-directory",
  root,
  "-p",
  project,
  "-f",
  join(root, "compose.verify.yaml"),
  "-f",
  override,
];
const result = {
  runId,
  project,
  mode: "native-java",
  // 运行时属于验收证据；记录版本，不把 Windows 原生进程异常重试成通过。
  nodeVersion: process.version,
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  sourceFingerprint: deploymentFingerprint(root),
};
const runtimes = new Map();
let created = false;
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** 子进程输入使用参数数组/标准输入；不把配置值拼入 shell，也不打印完整环境。 */
function execute(
  command,
  args,
  { input, env = environment, log, cwd = root, allowFailure = false } = {},
) {
  const response = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600000,
  });
  if (log)
    writeFileSync(
      join(output, log),
      (response.stdout ?? "") + (response.stderr ?? ""),
    );
  if (!allowFailure && (response.error || response.status !== 0))
    throw new Error(`验收子进程失败，详见 ${log ?? "本机服务状态"}`, {
      cause: response.error,
    });
  return response;
}
const docker = (args, options) => execute("docker", args, options).stdout;
function query(compose, service, sql) {
  assert(["mysql", "upgrade-db", "fresh-db", "script-db"].includes(service));
  return docker(
    [
      ...compose,
      "exec",
      "-T",
      service,
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
    ],
    { input: sql, log: "last-query.log" },
  );
}
const migrations = (compose, service) =>
  query(
    compose,
    service,
    "SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank;",
  ).trim();
function mark(name, detail) {
  result.checks.push({ name, status: "passed", detail });
  console.log("通过：" + name);
}

/** 申请空闲端口只绑定 loopback；稍后服务竞争失败会报告，不杀占用端口的其他进程。 */
async function freePort() {
  const server = createServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((ready, reject) =>
    server.close((error) => (error ? reject(error) : ready())),
  );
  return address.port;
}

/** 只停止本脚本启动并持有句柄的 Java，不根据端口/进程名批量停止。 */
async function stopRuntime(label) {
  const runtime = runtimes.get(label);
  if (
    !runtime?.child.pid ||
    runtime.child.exitCode !== null ||
    runtime.child.signalCode !== null
  )
    return;
  runtime.child.kill();
  for (
    let attempt = 0;
    attempt < 40 &&
    runtime.child.exitCode === null &&
    runtime.child.signalCode === null;
    attempt++
  )
    await delay(250);
  assert(
    runtime.child.exitCode !== null || runtime.child.signalCode !== null,
    "隔离 Java 未停止：" + label,
  );
}
async function startRuntime(
  label,
  ports,
  extra = {},
  expectedFailure = null,
  timeZone = label === "fresh" ? "Asia/Shanghai" : "UTC",
) {
  // 同一制品在不同 JVM 默认区验收；不能依靠把 CI 的 TZ 改成北京时间绕过跨环境缺陷。
  assert(
    ["UTC", "Asia/Shanghai"].includes(timeZone),
    "验收 JVM 时区不在白名单",
  );
  assert(
    [
      "upgrade",
      "fresh",
      "script",
      "production",
      "production-rejected",
      "production-existing-rejected",
      "modules",
    ].includes(label),
  );
  await stopRuntime(label);
  const files = join(output, "native-files", label);
  mkdirSync(files, { recursive: true });
  const env = javaRuntimeEnvironment(environment, {
    SERVER_ADDRESS: "127.0.0.1",
    SERVER_PORT: String(ports.api),
    DB_URL: `jdbc:mysql://127.0.0.1:${ports.database}/mayday_verify?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
    DB_USERNAME: "mayday_verify",
    DB_PASSWORD: environment.VERIFY_DB_PASSWORD,
    ADMIN_PASSWORD: settings.ADMIN_PASSWORD,
    SEED_DEMO_DATA: "false",
    MODULE_WORKORDERS_ENABLED: "true",
    MAYDAY_STORAGE_MODE: "LOCAL",
    MAYDAY_STORAGE_LOCAL_ROOT: files,
    MAYDAY_BULK_SPOOL_DIRECTORY: join(output, "native-bulk", label),
    MAYDAY_BULK_CLEANUP_INTERVAL_MS: "1000",
    ...identityEnvironment,
    ...(label === "upgrade" && settings.MAYDAY_IDENTITY_ENCRYPTION_KEY
      ? {
          MAYDAY_IDENTITY_ENCRYPTION_KEY:
            settings.MAYDAY_IDENTITY_ENCRYPTION_KEY,
        }
      : {}),
    ...extra,
  });
  const logPath = join(output, `${label}-java.log`),
    errorPath = join(output, `${label}-java.error.log`);
  const logOffset = existsSync(logPath) ? statSync(logPath).size : 0,
    errorOffset = existsSync(errorPath) ? statSync(errorPath).size : 0;
  const out = openSync(logPath, "a"),
    err = openSync(errorPath, "a");
  const child = spawn(
    java,
    [
      `-Duser.timezone=${timeZone}`,
      "-jar",
      join(output, "verified-runtime.jar"),
      "--spring.config.location=classpath:/application.yml",
    ],
    {
      cwd: root,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, err],
    },
  );
  closeSync(out);
  closeSync(err);
  const runtime = { child, env, files, ports, spawnError: null };
  child.once("error", (error) => {
    runtime.spawnError = error;
  });
  child.unref();
  runtimes.set(label, runtime);
  let healthy = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    assert(!runtime.spawnError, `隔离 ${label} Java 启动失败，见对应日志`);
    if (
      (label === "production-rejected" || expectedFailure) &&
      child.exitCode !== null
    ) {
      assert.notEqual(
        child.exitCode,
        0,
        "不安全配置不能正常退出并视为拒绝成功",
      );
      const logs =
        readFileSync(logPath).subarray(logOffset).toString("utf8") +
        readFileSync(errorPath).subarray(errorOffset).toString("utf8");
      assert(
        expectedFailure
          ? logs.includes(expectedFailure)
          : logs.includes("生产启动检查未通过") &&
              logs.includes("ADMIN_PASSWORD"),
      );
      assert(!logs.includes(env.DB_PASSWORD), "拒绝启动日志泄露数据库口令");
      if (env.MAYDAY_IDENTITY_ENCRYPTION_KEY)
        assert(
          !logs.includes(env.MAYDAY_IDENTITY_ENCRYPTION_KEY),
          "拒绝启动日志泄露身份密钥",
        );
      return;
    }
    assert(
      child.exitCode === null && child.signalCode === null,
      `隔离 ${label} Java 退出，见对应日志`,
    );
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${ports.api}/actuator/health`, {
        signal: AbortSignal.timeout(1500),
      });
    } catch {}
    if (response?.ok && (await response.json()).status === "UP") {
      // 网络尚未监听可等待；门禁断言不得吞进网络重试，否则短暂开放也会被误记为拒启通过。
      assert(
        !expectedFailure && label !== "production-rejected",
        "预期拒启的隔离服务不能进入健康状态",
      );
      healthy = true;
      break;
    }
    await delay(1000);
  }
  assert.notEqual(label, "production-rejected", "不安全生产配置未拒绝启动");
  assert(!expectedFailure, "身份密钥门禁没有拒绝启动");
  assert(healthy, `隔离 ${label} 未就绪，见对应日志`);
}

/** 原生方式仍执行真实生产门禁、DML权限及数据库失联探针，不用单元替身代替部署检查。 */
async function productionChecks(ports) {
  const database = "mayday_production_verify",
    user = "mayday_runtime_verify";
  const password = randomBytes(24).toString("hex"),
    admin = randomBytes(24).toString("hex");
  const rootQuery = (sql) =>
    docker(
      [
        ...checkCompose,
        "exec",
        "-T",
        "fresh-db",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --default-character-set=utf8mb4 --batch --raw --skip-column-names',
      ],
      { input: sql },
    );
  rootQuery(
    `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON ${database}.* TO 'mayday_verify'@'%'; CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'; GRANT SELECT,INSERT,UPDATE,DELETE ON ${database}.* TO '${user}'@'%';`,
  );
  const ownPorts = { database: ports.fresh.database, api: await freePort() };
  const secure = {
    DB_URL: `jdbc:mysql://127.0.0.1:${ownPorts.database}/${database}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
    MAYDAY_PRODUCTION: "true",
    MAYDAY_PUBLIC_ORIGIN: "https://portal.example.invalid",
    ADMIN_PASSWORD: admin,
    API_DOCS_ENABLED: "false",
    SEED_DEMO_DATA: "false",
    // QA的HTTP提供方不能进入生产配置；只保留MFA，使用本轮独立加密密钥。
    MAYDAY_IDENTITY_PROVIDERS_0_ENABLED: "false",
  };
  await startRuntime("production-rejected", ownPorts, {
    ...secure,
    ADMIN_PASSWORD: "Mayday@2026",
  });
  mark("原生生产：拒绝示例口令，错误不公开凭据");
  await startRuntime("production", ownPorts, secure);
  const base = `http://127.0.0.1:${ownPorts.api}`;
  async function health(group, expected = 200) {
    const response = await fetch(base + "/actuator/health/" + group, {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, expected);
    const body = await response.json();
    assert(!body.components, "匿名探针不能公开内部组件");
    return body.status;
  }
  for (const group of ["liveness", "readiness"])
    assert.equal(await health(group), "UP");
  assert.equal(
    rootQuery(`SELECT COUNT(*) FROM ${database}.sys_user;`).trim(),
    "1",
  );
  assert.equal(
    rootQuery(`SELECT COUNT(*) FROM ${database}.cms_notice;`).trim(),
    "0",
  );
  const session = await loginWithCaptcha(base + "/api", "admin", admin);
  const headers = { Authorization: `Bearer ${session.token}` };
  try {
    const response = await fetch(base + "/api/platform/openapi", {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 404, "真实管理员也不能访问关闭的契约");
  } finally {
    const response = await fetch(base + "/api/auth/logout", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
  }
  mark("原生生产：纯净初始化、匿名探针与管理员契约关闭");
  // 用实际改密接口构造已存在弱管理员，环境密码保持强值；拒启必须发生在健康/监听之前。
  const originalHash = rootQuery(
    `SELECT password_hash FROM ${database}.sys_user WHERE username='admin';`,
  ).trim();
  assert(
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(originalHash),
    "私库管理员散列格式不合法",
  );
  const weakSession = await loginWithCaptcha(base + "/api", "admin", admin);
  const weakPassword = await fetch(base + "/api/auth/password", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${weakSession.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ oldPassword: admin, newPassword: "Mayday@2026" }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(
    weakPassword.status,
    200,
    "未成功建立本轮私库的既有弱密码验收条件",
  );
  await stopRuntime("production");
  try {
    await startRuntime(
      "production-existing-rejected",
      ownPorts,
      secure,
      "既有管理员仍使用示例密码",
    );
  } finally {
    await stopRuntime("production-existing-rejected");
    rootQuery(
      `UPDATE ${database}.sys_user SET password_hash='${originalHash}' WHERE username='admin';`,
    );
  }
  mark("原生生产：既有管理员弱密码即使环境已轮换也在开放服务前拒启");
  await startRuntime("production", ownPorts, {
    ...secure,
    DB_USERNAME: user,
    DB_PASSWORD: password,
    DB_MIGRATIONS_ENABLED: "false",
  });
  const grants = rootQuery(`SHOW GRANTS FOR '${user}'@'%';`);
  assert(grants.includes("SELECT, INSERT, UPDATE, DELETE"));
  assert(!/CREATE|ALTER|DROP|ALL PRIVILEGES/.test(grants));
  assert.equal(
    rootQuery(`SELECT COUNT(*) FROM ${database}.sys_user;`).trim(),
    "1",
  );
  const second = await loginWithCaptcha(base + "/api", "admin", admin);
  try {
    const response = await fetch(base + "/api/auth/me", {
      headers: { Authorization: `Bearer ${second.token}` },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(
      response.status,
      200,
      "DML账号应能通过共享验证码、限流和会话读写",
    );
  } finally {
    await fetch(base + "/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${second.token}` },
      signal: AbortSignal.timeout(10000),
    });
  }
  mark("原生生产：DDL迁移与DML运行账号分离，重启不重复初始化");
  let stopped = false;
  try {
    docker([...checkCompose, "stop", "fresh-db"], {
      log: "production-database-stop.log",
    });
    stopped = true;
    assert.equal(await health("liveness"), "UP");
    assert.equal(await health("readiness", 503), "DOWN");
    mark("原生生产：数据库失联停止接流量，存活探针保持UP");
  } finally {
    await stopRuntime("production");
    if (stopped)
      docker(
        [...checkCompose, "up", "-d", "--no-build", "--wait", "fresh-db"],
        { log: "production-database-restart.log" },
      );
  }
}

/** 使用同一冻结产物核对关闭模块后的HTTP、导航、权限候选与依赖，不只读配置值。 */
async function moduleChecks(ports) {
  const ownPorts = { database: ports.fresh.database, api: await freePort() };
  for (const profile of moduleProfiles) {
    const flags = Object.fromEntries(
      Object.entries(profile.flags).map(([key, value]) => [
        `MODULE_${key}_ENABLED`,
        String(value),
      ]),
    );
    try {
      await startRuntime("modules", ownPorts, flags);
      await verifyModuleProfile(
        `http://127.0.0.1:${ownPorts.api}/api`,
        settings.ADMIN_PASSWORD,
        profile,
      );
      mark("原生模块裁剪：" + profile.name);
    } finally {
      await stopRuntime("modules");
    }
  }
}

/** 并行和父子游标在真正进程停止后继续办理；标记只允许本轮随机项目，清理失败也会使验收失败。 */
async function workflowRestartCheck(ports) {
  const env = {
    ...apiEnvironment("fresh"),
    WORKFLOW_RESTART_MARKER: join(output, "workflow-restart.json"),
  };
  try {
    execute(
      process.execPath,
      ["scripts/verify-workflow-restart.mjs", "--prepare"],
      { env, log: "workflow-restart-prepare.log" },
    );
    await startRuntime("fresh", ports.fresh);
    execute(
      process.execPath,
      ["scripts/verify-workflow-restart.mjs", "--verify"],
      { env, log: "workflow-restart-verify.log" },
    );
    mark("真正Java重启后沿原并行/父子游标办理，无重复任务及子申请");
  } finally {
    execute(
      process.execPath,
      ["scripts/verify-workflow-restart.mjs", "--cleanup"],
      { env, log: "workflow-restart-cleanup.log" },
    );
  }
}

// 原业务使用升级前显式字段比较，新增 nullable 列不能制造假差异，原授权和已采集文件必须保持。
const originalColumns = {
  sys_user:
    "id,username,password_hash,nickname,email,phone,department_id,enabled,created_at,updated_at,version",
  sys_role: "id,code,name,description,enabled,created_at,updated_at,version",
  sys_role_permission: "role_id,permission",
  sys_role_scope: "role_id,resource,data_scope",
  sys_user_role: "user_id,role_id",
  sys_entry:
    "id,kind,name,code,value,description,permission,path,parent_id,sort_order,enabled,created_at,updated_at,version",
  cms_notice:
    "id,title,category,summary,content,published,author_id,department_id,author_name,created_at,updated_at,version",
};
function originalSnapshot(compose, service, entryLimit) {
  return Object.fromEntries(
    Object.entries(originalColumns).map(([table, columns]) => [
      table,
      hash(
        query(
          compose,
          service,
          // 排序固定长度的完整行摘要，不能让长正文/BLOB进入MySQL默认排序缓冲区。
          `SELECT SHA2(CAST(${snapshotJsonFields(table, columns)} AS CHAR),256) FROM ${table}${table === "sys_entry" ? ` WHERE id<=${entryLimit}` : ""} ORDER BY 1;`,
        ),
      ),
    ]),
  );
}
// 会话、登录/操作审计及后台采样正常增长，不以删除这些日志制造清理通过；静态业务均比较。
const staticTables = [
  "sys_user",
  "sys_role",
  "sys_user_role",
  "sys_role_permission",
  "sys_role_scope",
  "sys_entry",
  "sys_dictionary_item",
  "sys_role_scope_department",
  "sys_user_post",
  "cms_notice",
  "cms_notice_tag",
  "cms_revision",
  "cms_revision_tag",
  "cms_revision_file",
  "cms_publication",
  "cms_portal_channel",
  "cms_portal_category",
  "cms_portal_home",
  "ops_notification",
  "ops_notification_target",
  "ops_notification_file",
  "ops_delivery",
  "ops_file",
  "ops_file_payload",
  "ops_file_directory",
  "sys_bulk_job",
  "sys_bulk_result",
  "sys_external_identity",
  "sys_mfa_credential",
  "sys_mfa_recovery",
  "ops_feedback",
  "ops_feedback_history",
  "ops_flow_definition",
  "ops_flow_version",
  "ops_flow_request",
  "ops_flow_decision",
  "ops_flow_step",
  "ops_request_step",
  "ops_request_file",
  "ops_flow_task",
  "ops_event",
  "ops_message",
  "ops_flow_delegation",
  "crawl_task",
  "crawl_item",
  "crawl_article",
  "crawl_article_image",
  "biz_work_order",
];
function staticSnapshot(service) {
  const schema = readDatabaseMetadata((sql) =>
    query(checkCompose, service, sql),
  );
  return Object.fromEntries(
    staticTables
      .filter((table) => schema.some((t) => t.name === table))
      .map((table) => {
        return [
          table,
          hash(
            query(
              checkCompose,
              service,
              // HEX保留二进制、分隔符与NULL的精确含义，不能将BLOB按UTF-8解码后比较。
              `SELECT SHA2(CAST(JSON_ARRAY(${schema
                .find((t) => t.name === table)
                .columns.map(
                  (c) =>
                    `IF(\`${c.name}\` IS NULL,NULL,HEX(CAST(\`${c.name}\` AS BINARY)))`,
                )
                .join(",")}) AS CHAR),256) FROM ${table} ORDER BY 1;`,
            ),
          ),
        ];
      }),
  );
}

/** 逐表比较固定业务表快照，失败时只报告环境与表名，不暴露快照摘要或业务内容。 */
function assertStaticSnapshot(service, expected, actual) {
  const label = service.replace(/-db$/, "");
  const tables = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const table of tables)
    assert.equal(
      actual[table],
      expected[table],
      `${label} 临时业务数据未清理：${table}`,
    );
}
/**
 * Node/Docker 验收保留宿主 CLI 插件发现环境，Java 仍使用独立的白名单环境。
 * 本轮随机口令及 Compose 完整参数显式覆盖宿主配置，SQL 不会回退日常项目或日常 .env。
 */
function apiEnvironment(label) {
  const runtime = runtimes.get(label);
  assert(runtime && ["fresh", "upgrade"].includes(label));
  return isolatedApiEnvironment(environment, runtime.env, {
    project,
    database: label + "-db",
    base: `http://127.0.0.1:${runtime.ports.api}/api`,
    files: runtime.files,
    compose: checkCompose,
    databasePassword: environment.VERIFY_DB_PASSWORD,
    adminPassword: settings.ADMIN_PASSWORD,
  });
}

async function apiSuite(label) {
  const files = [
    "api",
    "workflow",
    "workflow-decimal",
    "security",
    "theme",
    "captcha",
    "crawler",
    "business-module",
    "realtime-workflow",
    "file-center",
    "bulk-data",
    "general-platform",
    "portal",
    "workflow-orchestration",
    "workflow-field-activation",
    "identity",
    "shared-execution",
  ].map((name) => `tests/${name}.test.mjs`);
  const env = apiEnvironment(label);
  // 在任何写入夹具前证明 CLI、覆盖配置与 SQL 已连到隔离数据库；失败不继续制造状态残留。
  assert.equal(
    isolatedSql("SELECT DATABASE();", { environment: env }).trim(),
    "mayday_verify",
  );
  const reportPath = join(output, `api-${label}-diagnostic.json`);
  const diagnostic = apiDiagnosticReporterOptions({
    phase: label,
    testFiles: files,
    reportPath,
  });
  // 接口套件可能持续数分钟；异步等待保持 HTTP 超时与自有 Java 退出事件可处理，认证失败不自动重试。
  const checked = await runVerificationProcess(
    process.execPath,
    ["--test", ...diagnostic.args, "--test-concurrency=1", ...files],
    {
      cwd: root,
      env: { ...env, ...diagnostic.env },
      logPath: join(output, `api-${label}.log`),
    },
  );
  if (checked.error || checked.status !== 0) {
    const failure = publicApiFailureDiagnostic({
      phase: label,
      root,
      testFiles: files,
      response: checked,
      reportPath,
    });
    writeFileSync(
      join(output, `api-${label}-failure.json`),
      JSON.stringify(failure, null, 2),
    );
    result.apiFailure = failure;
    console.error("API 回归脱敏失败摘要：" + JSON.stringify(failure));
    throw new Error(`真实 API 验收失败，见 api-${label}-failure.json`);
  }
  const counts = Object.fromEntries(
    [
      ...checked.stdout.matchAll(
        /^# (tests|pass|fail|cancelled|skipped) (\d+)$/gm,
      ),
    ].map((match) => [match[1], Number(match[2])]),
  );
  assert(
    counts.tests > 0 && counts.pass === counts.tests,
    "真实接口检查必须实际执行全部断言",
  );
  assert.equal(counts.skipped, 0, "接口条件跳过不得算本轮通过");
  assert.equal(counts.fail, 0);
  assert.equal(counts.cancelled, 0);
  mark(`${label}：完整真实 MySQL HTTP 回归`, counts);
}

try {
  console.log("原生验收记录：" + output);
  const sourceVersions = migrations(sourceCompose, "mysql");
  const sourceSchema = readDatabaseMetadata((sql) =>
    query(sourceCompose, "mysql", sql),
  );
  Object.assign(originalColumns, preservedBusinessColumns(sourceSchema));
  if (sourceSchema.some((t) => t.name === "sys_mfa_credential")) {
    const adminMfa = query(
      sourceCompose,
      "mysql",
      "SELECT COUNT(*) FROM sys_mfa_credential m JOIN sys_user u ON u.id=m.user_id WHERE u.username='admin';",
    ).trim();
    assert.equal(
      adminMfa,
      "0",
      "原管理员已启用MFA，本验证入口需要具备完整因素的受控验收登录；不能删除原凭据或跳过因素进行回归",
    );
    const enrolled = query(
      sourceCompose,
      "mysql",
      "SELECT COUNT(*) FROM sys_mfa_credential;",
    ).trim();
    assert(
      enrolled === "0" || settings.MAYDAY_IDENTITY_ENCRYPTION_KEY,
      "恢复已有MFA数据必须提供原身份加密密钥，不生成新key替换原凭据",
    );
  }
  const entryLimit = Number(
    query(
      sourceCompose,
      "mysql",
      "SELECT COALESCE(MAX(id),0) FROM sys_entry;",
    ).trim(),
  );
  assert(Number.isSafeInteger(entryLimit));
  const before = originalSnapshot(sourceCompose, "mysql", entryLimit);
  const beforeCrawler = readCrawlerMenu((sql) =>
    query(sourceCompose, "mysql", sql),
  );
  writeFileSync(join(output, "before.json"), JSON.stringify(before, null, 2));
  writeFileSync(join(output, "source-migrations.txt"), sourceVersions);
  const dump = docker(
    [
      ...sourceCompose,
      "exec",
      "-T",
      "mysql",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF --skip-comments --skip-add-locks --hex-blob "$MYSQL_DATABASE"',
    ],
    { log: "backup-command.log" },
  );
  writeFileSync(join(output, "before.sql"), dump);
  result.backup = { bytes: Buffer.byteLength(dump), sha256: hash(dump) };
  assert.deepEqual(
    originalSnapshot(sourceCompose, "mysql", entryLimit),
    before,
    "备份期间原业务变化，请重新验收",
  );
  mark("原库只读一致性备份");
  execute(process.execPath, ["scripts/check-project.mjs"], {
    log: "project-check.log",
  });
  mark("前端交互、格式、注释、契约、类型与生产构建");
  const frontendDirectory = join(output, "verified-frontend");
  cpSync(join(root, "frontend", "dist"), frontendDirectory, {
    recursive: true,
  });
  result.frontendManifest = fileManifest(frontendDirectory);
  execute(
    process.platform === "win32" ? "cmd.exe" : "bash",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "mvnw.cmd -B verify"]
      : ["./mvnw", "-B", "verify"],
    { cwd: join(root, "backend"), log: "java-verify.log" },
  );
  assertVerifiedInputs(result.sourceFingerprint, deploymentFingerprint(root));
  copyFileSync(
    join(
      root,
      "backend/mayday-application/target/mayday-application-1.0.0.jar",
    ),
    join(output, "verified-runtime.jar"),
  );
  result.artifactSha256 = hash(
    readFileSync(join(output, "verified-runtime.jar")),
  );
  mark("全部 Java 模块构建及产物冻结");
  const ports = {};
  for (const label of ["upgrade", "fresh", "script"])
    ports[label] = { database: await freePort(), api: await freePort() };
  writeFileSync(
    override,
    JSON.stringify({
      services: Object.fromEntries(
        Object.entries(ports).map(([label, p]) => [
          label + "-db",
          { ports: [`127.0.0.1:${p.database}:3306`] },
        ]),
      ),
    }),
  );
  created = true;
  docker(
    [
      ...checkCompose,
      "up",
      "-d",
      "--wait",
      "upgrade-db",
      "fresh-db",
      "script-db",
    ],
    { log: "databases.log" },
  );
  query(checkCompose, "upgrade-db", dump);
  query(
    checkCompose,
    "script-db",
    readFileSync(join(root, "database/mayday.sql"), "utf8"),
  );
  assert.deepEqual(
    originalSnapshot(checkCompose, "upgrade-db", entryLimit),
    before,
    "独立恢复与原业务备份不一致",
  );
  mark("备份恢复与唯一 SQL 空库导入");
  for (const label of ["upgrade", "fresh", "script"])
    await startRuntime(label, ports[label]);
  const upgradedCrawler = readCrawlerMenu((sql) =>
    query(checkCompose, "upgrade-db", sql),
  );
  verifyCrawlerMenuRename(beforeCrawler, upgradedCrawler);
  const schemas = {},
    constraints = {};
  for (const label of ["upgrade", "fresh", "script"]) {
    schemas[label] = verifyDatabaseComments((sql) =>
      query(checkCompose, label + "-db", sql),
    );
    constraints[label] = readDatabaseConstraints((sql) =>
      query(checkCompose, label + "-db", sql),
    );
  }
  assert.deepEqual(
    structuralColumns(schemas.upgrade),
    structuralColumns(schemas.fresh),
  );
  assert.deepEqual(
    structuralColumns(schemas.script),
    structuralColumns(schemas.fresh),
  );
  assert.deepEqual(constraints.upgrade, constraints.fresh);
  assert.deepEqual(constraints.script, constraints.fresh);
  const currentVersions = migrations(checkCompose, "upgrade-db");
  writeFileSync(join(output, "upgrade-migrations.txt"), currentVersions);
  writeFileSync(
    join(output, "fresh-migrations.txt"),
    migrations(checkCompose, "fresh-db"),
  );
  assert.equal(currentVersions, migrations(checkCompose, "fresh-db"));
  const sqlVersion = /VALUES \(1, '(\d+)', '<< Flyway Baseline >>'/.exec(
    readFileSync(join(root, "database/mayday.sql"), "utf8"),
  )?.[1];
  assert(sqlVersion);
  assert.equal(
    query(
      checkCompose,
      "script-db",
      "SELECT version,type,success FROM flyway_schema_history;",
    ).trim(),
    `${sqlVersion}\tBASELINE\t1`,
  );
  const second = execute(
    "docker",
    [
      ...checkCompose,
      "exec",
      "-T",
      "script-db",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4',
    ],
    {
      input: readFileSync(join(root, "database/mayday.sql"), "utf8"),
      allowFailure: true,
      log: "repeat-import.log",
    },
  );
  assert.notEqual(second.status, 0, "非空库重复导入必须拒绝");
  result.database = {
    tables: schemas.fresh.length,
    columns: schemas.fresh.reduce((n, t) => n + t.columns.length, 0),
    indexes: constraints.fresh.indexes.length,
    foreignKeys: constraints.fresh.foreignKeys.length,
  };
  mark("三安装路径结构、约束、中文注释一致，拒绝重复导入", result.database);
  assert.deepEqual(
    originalSnapshot(checkCompose, "upgrade-db", entryLimit),
    before,
    "迁移改变原业务或授权",
  );
  assert.equal(
    query(checkCompose, "fresh-db", "SELECT COUNT(*) FROM sys_user;").trim(),
    "1",
  );
  assert.equal(
    query(checkCompose, "fresh-db", "SELECT COUNT(*) FROM cms_notice;").trim(),
    "0",
  );
  mark("纯净安装与保留原数据升级");
  execute(process.execPath, ["scripts/generate-api.mjs", "--check"], {
    env: {
      ...environment,
      API_BASE: `http://127.0.0.1:${ports.fresh.api}/api`,
      ADMIN_PASSWORD: settings.ADMIN_PASSWORD,
    },
    log: "contract.log",
  });
  let businessTime;
  try {
    businessTime = await verifyBusinessTime({
      apiBase: `http://127.0.0.1:${ports.fresh.api}/api`,
      adminPassword: settings.ADMIN_PASSWORD,
      project,
      database: "fresh-db",
      restart: (timeZone) =>
        startRuntime("fresh", ports.fresh, {}, null, timeZone),
      sql: (statement) => query(checkCompose, "fresh-db", statement),
    });
  } catch (error) {
    // 失败仍停止整套；仅保存固定阶段、状态和清理结果，不展开口令、正文或 SQL 原始值。
    result.businessTimeFailure = publicBusinessTimeFailure(error);
    throw error;
  }
  assert(
    businessTime.status === "passed" &&
      businessTime.cleanupSucceeded === true &&
      businessTime.restored === true &&
      businessTime.checks.length === 9 &&
      businessTime.checks.every((check) => check.status === "passed"),
    "跨 JVM 物理业务时间、安全会话和自有夹具清理必须全部通过",
  );
  mark("UTC 与北京时间跨 JVM 保持物理 DATETIME 和安全会话时间点", businessTime);
  const beforeTests = {
    upgrade: staticSnapshot("upgrade-db"),
    fresh: staticSnapshot("fresh-db"),
  };
  await apiSuite("upgrade");
  await apiSuite("fresh");
  const identityRestart = await verifyIdentityRestart({
    apiBase: `http://127.0.0.1:${ports.fresh.api}/api`,
    adminPassword: settings.ADMIN_PASSWORD,
    project,
    database: "fresh-db",
    restart: (overrides) => startRuntime("fresh", ports.fresh, overrides),
    expectStartupFailure: (overrides, message) =>
      startRuntime("fresh", ports.fresh, overrides, message),
  });
  mark(
    "持久 MFA 正确密钥冷重启、关闭开通仍验证、缺失及错误密钥拒启",
    identityRestart,
  );
  // 使用同一冻结制品验证真实安全操作的并发边界；旧版本漏洞复现不能作为发布通过。
  const identityRace = await verifyIdentityRace({
    jar: join(output, "verified-runtime.jar"),
    java,
    root,
  });
  assert(
    identityRace.status === "passed" &&
      identityRace.cleanupSucceeded === true &&
      identityRace.artifactSha256 === result.artifactSha256 &&
      identityRace.checks.length === 3 &&
      identityRace.checks.every(
        (check) =>
          check.status === "passed" &&
          check.mutationStatus === 200 &&
          check.accountLockWaitProved === true &&
          check.noSessionIssued === true,
      ),
    "身份并发撤销、MFA 开通当前读与自有环境清理必须全部通过",
  );
  mark("企业身份解绑和 MFA 开通与并发登录的当前读边界", identityRace);
  await workflowRestartCheck(ports);
  for (const label of ["upgrade", "fresh"])
    assertStaticSnapshot(
      label + "-db",
      beforeTests[label],
      staticSnapshot(label + "-db"),
    );
  assert.deepEqual(
    originalSnapshot(checkCompose, "upgrade-db", entryLimit),
    before,
  );
  mark("回归结束后原业务及临时数据清理一致");
  await startRuntime("upgrade", ports.upgrade);
  assert.equal(migrations(checkCompose, "upgrade-db"), currentVersions);
  assert.deepEqual(
    originalSnapshot(checkCompose, "upgrade-db", entryLimit),
    before,
  );
  mark("Java 冷重启保持原业务、授权及迁移");
  assert.deepEqual(
    readCrawlerMenu((sql) => query(checkCompose, "upgrade-db", sql)),
    upgradedCrawler,
    "回归及冷重启改变内置菜单未归一化字段",
  );
  await productionChecks(ports);
  await moduleChecks(ports);
  assert.equal(migrations(sourceCompose, "mysql"), sourceVersions);
  assert.deepEqual(
    originalSnapshot(sourceCompose, "mysql", entryLimit),
    before,
  );
  assert.deepEqual(
    readCrawlerMenu((sql) => query(sourceCompose, "mysql", sql)),
    beforeCrawler,
    "日常内置菜单发生变化",
  );
  assertVerifiedInputs(result.sourceFingerprint, deploymentFingerprint(root));
  mark("日常库只读，构建及验收输入未变化");
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  process.exitCode = 1;
  console.error("原生隔离验收失败：" + error.message);
} finally {
  for (const label of runtimes.keys()) {
    try {
      await stopRuntime(label);
    } catch (error) {
      result.status = "failed";
      result.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  if (created) {
    assert(/^mayday-check-\d+-[a-f0-9]{6}$/.test(project));
    const cleanup = execute(
      "docker",
      [...checkCompose, "down", "--volumes", "--remove-orphans"],
      { allowFailure: true, log: "cleanup.log" },
    );
    result.cleanup = cleanup.status === 0 ? "passed" : "failed";
    if (cleanup.status !== 0) {
      result.status = "failed";
      process.exitCode = 1;
    }
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(`原生验收结果：${result.status}，${join(output, "result.json")}`);
}
