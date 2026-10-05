/**
 * 更新 Windows 本机 Java/Vite 预览，要求相同源码已通过原生隔离验收。
 * 只停止 processes.json 指向且命令路径核对一致的本项目进程；数据库及数据卷保持运行。
 * 停写后备份完整 SQL 与 LOCAL 文件，再使用验收冻结的 jar/前端产物，不发布正在编辑的源码。
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  openSync,
  closeSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import {
  deploymentFingerprint,
  assertVerifiedInputs,
} from "./deployment-inputs.mjs";
import { fileManifest, assertRestoredFiles } from "./file-backup.mjs";
import {
  snapshotJsonFields,
  preservedBusinessColumns,
  readCrawlerMenu,
  verifyCrawlerMenuRename,
} from "./migration-snapshot.mjs";
import {
  javaRuntimeEnvironment,
  assertLocalDockerEndpoint,
} from "./runtime-environment.mjs";
import { readDatabaseMetadata } from "./database-docs.mjs";
import {
  clusterReportArgument,
  verifiedClusterReport,
} from "./cluster-release-gate.mjs";

assert.equal(
  process.platform,
  "win32",
  "本入口只管理 Windows 原生服务；其他环境使用 Compose 升级",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// SQL、原配置及业务文件属于私有恢复点；Unix 权限保持为当前用户，Windows 使用受控 ACL。
process.umask(0o077);
assertLocalDockerEndpoint();
const baseline = join(root, ".local", "baseline");
const passed = readdirSync(baseline)
  .sort()
  .reverse()
  .map((id) => {
    try {
      return {
        path: join(baseline, id),
        ...JSON.parse(readFileSync(join(baseline, id, "result.json"), "utf8")),
      };
    } catch {
      return null;
    }
  })
  .find(
    (record) => record?.status === "passed" && record.mode === "native-java",
  );
assert(passed, "需先完成 scripts/verify-native-baseline.mjs");
assertVerifiedInputs(passed.sourceFingerprint, deploymentFingerprint(root));
const hash = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(
  hash(readFileSync(join(passed.path, "verified-runtime.jar"))),
  passed.artifactSha256,
  "验收 jar 摘要不一致",
);
assertRestoredFiles(
  passed.frontendManifest,
  fileManifest(join(passed.path, "verified-frontend")),
);
// 集群证据在停止日常服务前完成核验，不能拿单节点基线替代双实例及硬故障恢复验收。
const clusterVerification = verifiedClusterReport(
  root,
  passed.artifactSha256,
  clusterReportArgument(process.argv.slice(2)),
);
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
// 在停服务前拒绝 .env 内可覆盖实际数据库的配置入口。
javaRuntimeEnvironment(process.env, settings);
const processes = JSON.parse(
  readFileSync(join(root, ".local", "processes.json"), "utf8"),
);
assert.equal(resolve(processes.root), root, "进程记录不属于当前项目");
const runtime = join(root, ".local", "mayday-runtime.jar");
const normalize = (value) => value.replaceAll("\\", "/").toLowerCase();
function processInfo(id) {
  assert(Number.isSafeInteger(id) && id > 0);
  const response = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter 'ProcessId=${id}' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(response.status, 0, "无法核对本机进程身份");
  return response.stdout.trim() ? JSON.parse(response.stdout) : null;
}
const backend = processInfo(processes.backend),
  frontend = processInfo(processes.frontend);
assert(
  backend?.Name.toLowerCase() === "java.exe" &&
    normalize(backend.CommandLine).includes(normalize(runtime)),
  "后台进程不是本项目运行副本，不停止",
);
assert(
  frontend?.Name.toLowerCase() === "node.exe" &&
    normalize(frontend.CommandLine).includes(
      normalize(
        join(root, "frontend", "node_modules", "vite", "bin", "vite.js"),
      ),
    ),
  "前端进程不是本项目 Vite，不停止",
);
const id = new Date().toISOString().replace(/\D/g, "");
const output = join(root, ".local", "upgrades", id);
mkdirSync(output, { recursive: true });
const result = {
  mode: "native-java",
  status: "running",
  startedAt: new Date().toISOString(),
  verification: passed.path,
  sourceFingerprint: passed.sourceFingerprint,
  clusterVerification,
  checks: [],
};
const compose = [
  "compose",
  "--project-directory",
  root,
  "-f",
  join(root, "compose.yaml"),
];
function docker(args, { input, log = "command.log" } = {}) {
  const response = spawnSync("docker", [...compose, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600000,
  });
  writeFileSync(
    join(output, log),
    (response.stdout ?? "") + (response.stderr ?? ""),
  );
  assert(response.status === 0 && !response.error, "升级命令失败，见 " + log);
  return response.stdout;
}
const query = (sql) =>
  docker(
    [
      "exec",
      "-T",
      "mysql",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
    ],
    { input: sql, log: "last-query.log" },
  );
const migrations = () =>
  query(
    "SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank;",
  ).trim();
function mark(name) {
  result.checks.push(name);
  console.log("通过：" + name);
}
const columns = {
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
const snapshot = (limit) =>
  Object.fromEntries(
    Object.entries(columns).map(([table, fields]) => [
      table,
      hash(
        query(
          `SELECT SHA2(CAST(${snapshotJsonFields(table, fields)} AS CHAR),256) FROM ${table}${table === "sys_entry" ? ` WHERE id<=${limit}` : ""} ORDER BY 1;`,
        ),
      ),
    ]),
  );
/** 只操作本脚本已核对的 PID，不按端口或可执行文件名批量清理。 */
async function stop(id) {
  const response = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Stop-Process -Id ${id} -ErrorAction Stop`],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(response.status, 0, "原生进程未停止");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!processInfo(id)) return;
    await delay(250);
  }
  throw new Error("原生进程停止超时");
}
function launch(command, args, env, label, cwd = root) {
  const out = openSync(join(output, label + ".log"), "w"),
    err = openSync(join(output, label + ".error.log"), "w");
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
  });
  closeSync(out);
  closeSync(err);
  child.once("error", (error) => {
    child.launchError = error;
  });
  child.unref();
  return child;
}
let stopped = false;
try {
  // 备份对象必须与新 Java 的实际地址相同；.env 漂移不能让旧库核对替另一库升级背书。
  assert(
    /^[A-Za-z0-9_]+$/.test(settings.MYSQL_DATABASE ?? ""),
    "数据库名称不合法",
  );
  const databasePort = Number(settings.DB_PORT);
  assert(
    Number.isInteger(databasePort) && databasePort > 0 && databasePort <= 65535,
    "数据库端口不合法",
  );
  assert.equal(
    query("SELECT DATABASE();").trim(),
    settings.MYSQL_DATABASE,
    "配置与日常容器数据库不同",
  );
  assert.equal(
    query("SELECT SUBSTRING_INDEX(USER(),'@',1);").trim(),
    settings.MYSQL_USER,
    "配置与日常容器数据库账号不同",
  );
  const publishedPorts = docker(["port", "mysql", "3306"])
    .trim()
    .split(/\r?\n/);
  assert(
    publishedPorts.length > 0 &&
      publishedPorts.every(
        (address) => address === `127.0.0.1:${databasePort}`,
      ),
    "配置与日常数据库实际监听端口不同",
  );
  mark("日常数据库名称、账号及实际监听端口与升级目标一致");
  assert.equal(
    migrations(),
    readFileSync(join(passed.path, "source-migrations.txt"), "utf8").trim(),
    "日常迁移已改变，需要重新隔离验收",
  );
  copyFileSync(runtime, join(output, "before-runtime.jar"));
  copyFileSync(
    join(root, ".local", "processes.json"),
    join(output, "before-processes.json"),
  );
  Object.assign(columns, preservedBusinessColumns(readDatabaseMetadata(query)));
  await stop(processes.frontend);
  await stop(processes.backend);
  stopped = true;
  const limit = Number(
    query("SELECT COALESCE(MAX(id),0) FROM sys_entry;").trim(),
  );
  assert(Number.isSafeInteger(limit));
  const before = snapshot(limit);
  const beforeCrawler = readCrawlerMenu(query);
  writeFileSync(join(output, "before.json"), JSON.stringify(before, null, 2));
  const dump = docker(
    [
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
  result.databaseBackup = {
    bytes: Buffer.byteLength(dump),
    sha256: hash(dump),
  };
  // 配置含身份密钥，只保留在 gitignored 的受控恢复点；数据库与密钥必须同点恢复，不能公开提交。
  copyFileSync(join(root, ".env"), join(output, "before.env"));
  const files = resolve(
    root,
    settings.MAYDAY_STORAGE_LOCAL_ROOT ?? "data/files",
  );
  mkdirSync(files, { recursive: true });
  const manifest = fileManifest(files);
  cpSync(files, join(output, "files"), { recursive: true });
  assertRestoredFiles(manifest, fileManifest(join(output, "files")));
  writeFileSync(
    join(output, "files-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  result.localBackup = { files: manifest.files.length, bytes: manifest.bytes };
  mark("同一停写恢复点的 SQL 与 LOCAL 文件备份，旧 jar 已保留");
  assertVerifiedInputs(passed.sourceFingerprint, deploymentFingerprint(root));
  copyFileSync(join(passed.path, "verified-runtime.jar"), runtime);
  cpSync(join(passed.path, "verified-frontend"), join(output, "frontend"), {
    recursive: true,
  });
  assertRestoredFiles(
    passed.frontendManifest,
    fileManifest(join(output, "frontend")),
  );
  const apiPort = Number(settings.API_PORT ?? 18080),
    webPort = Number(settings.WEB_PORT ?? 15173);
  assert(
    Number.isInteger(apiPort) &&
      apiPort > 0 &&
      apiPort <= 65535 &&
      Number.isInteger(webPort) &&
      webPort > 0 &&
      webPort <= 65535,
  );
  const env = javaRuntimeEnvironment(process.env, {
    ...settings,
    DB_URL: `jdbc:mysql://127.0.0.1:${settings.DB_PORT}/${settings.MYSQL_DATABASE}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
    DB_USERNAME: settings.MYSQL_USER,
    DB_PASSWORD: settings.MYSQL_PASSWORD,
    SERVER_ADDRESS: "127.0.0.1",
    SERVER_PORT: String(apiPort),
  });
  const java = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", "java.exe") : "java";
  const backendProcess = launch(
    java,
    ["-jar", runtime, "--spring.config.location=classpath:/application.yml"],
    env,
    "backend",
  );
  result.pids = { backend: backendProcess.pid ?? null, frontend: null };
  writeFileSync(
    join(root, ".local", "processes.json"),
    JSON.stringify({ root, ...result.pids }, null, 2),
  );
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    assert(!backendProcess.launchError, "新后端启动失败，保留日志和备份");
    assert(
      backendProcess.exitCode === null && backendProcess.signalCode === null,
      "新后端退出，保留日志和备份，不自动覆盖回退",
    );
    try {
      const response = await fetch(
        `http://127.0.0.1:${apiPort}/actuator/health`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (response.ok && (await response.json()).status === "UP") {
        ready = true;
        break;
      }
    } catch {}
    await delay(1000);
  }
  assert(ready, "新后端未就绪");
  assert.equal(
    migrations(),
    readFileSync(join(passed.path, "upgrade-migrations.txt"), "utf8").trim(),
    "日常迁移与验收不一致",
  );
  assert.deepEqual(
    snapshot(limit),
    before,
    "原业务、授权、组织或采集引用发生变化",
  );
  verifyCrawlerMenuRename(beforeCrawler, readCrawlerMenu(query));
  // SQL 引用不变不能证明正文/缩略图完好，升级后的真实 LOCAL 目录必须逐文件保持原摘要。
  assertRestoredFiles(manifest, fileManifest(files));
  mark("升级后实际 LOCAL 正文、缩略图及对象路径与停写备份一致");
  mark("新后端健康，迁移及原业务摘要与验收一致");
  // 使用冻结后的生产静态文件，预览不读取正在开发的 src，不对外开放端口。
  const config = join(output, "vite-preview.config.mjs");
  writeFileSync(
    config,
    `export default {preview:{proxy:{"/api":"http://127.0.0.1:${apiPort}"}}};\n`,
  );
  const frontendProcess = launch(
    process.execPath,
    [
      join(root, "frontend", "node_modules", "vite", "bin", "vite.js"),
      "preview",
      "--config",
      config,
      "--outDir",
      join(output, "frontend"),
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    process.env,
    "frontend",
    join(root, "frontend"),
  );
  result.pids.frontend = frontendProcess.pid ?? null;
  writeFileSync(
    join(root, ".local", "processes.json"),
    JSON.stringify({ root, ...result.pids }, null, 2),
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    assert(!frontendProcess.launchError, "新前端启动失败，保留日志和备份");
    assert(
      frontendProcess.exitCode === null && frontendProcess.signalCode === null,
      "新前端退出",
    );
    try {
      const response = await fetch(`http://127.0.0.1:${webPort}/`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    ready = false;
    await delay(250);
  }
  assert(ready, "新前端未就绪");
  writeFileSync(
    join(root, ".local", "processes.json"),
    JSON.stringify(
      { root, backend: backendProcess.pid, frontend: frontendProcess.pid },
      null,
      2,
    ),
  );
  result.pids = { backend: backendProcess.pid, frontend: frontendProcess.pid };
  result.status = "passed";
  mark("本机前后台已使用同一验收版本，备份未删除");
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  result.businessWasStopped = stopped;
  process.exitCode = 1;
  console.error(error.message);
  console.error(
    "保留备份及故障现场，不删库或自动降级；按 docs/upgrade.md 恢复指南处理。",
  );
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log("原生升级记录：" + join(output, "result.json"));
}
