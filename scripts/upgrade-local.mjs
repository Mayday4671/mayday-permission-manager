/**
 * 更新现有本机 Compose 环境：以最近通过的隔离验收为门槛，先构建、保留旧镜像，
 * 停止业务服务后备份，再升级。永不删除数据卷，不自动执行破坏性的数据库回退。
 * 凭证只由容器读取；业务数据和日志留在 .local，终端只报告检查结果与文件位置。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  snapshotFields,
  readCrawlerMenu,
  verifyCrawlerMenuRename,
} from "./migration-snapshot.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = join(root, ".local", "baseline");
const passed = readdirSync(baseline)
  .sort()
  .reverse()
  .map((id) => {
    try {
      const path = join(baseline, id);
      return {
        path,
        ...JSON.parse(readFileSync(join(path, "result.json"), "utf8")),
      };
    } catch {
      return null;
    }
  })
  .find((r) => r?.status === "passed");
assert(passed, "请先完成 scripts/verify-baseline.mjs 隔离验收");
const id = new Date().toISOString().replace(/[^0-9]/g, "");
const out = join(root, ".local", "upgrades", id);
mkdirSync(out, { recursive: true });
const compose = [
  "compose",
  "--project-directory",
  root,
  "-f",
  join(root, "compose.yaml"),
];
const result = {
  startedAt: new Date().toISOString(),
  verification: passed.path,
  status: "running",
  checks: [],
};
const hash = (s) => createHash("sha256").update(s).digest("hex");
function command(args, { input, log = "commands.log" } = {}) {
  const r = spawnSync("docker", args, {
    cwd: root,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600000,
  });
  writeFileSync(join(out, log), (r.stdout ?? "") + (r.stderr ?? ""));
  assert(r.status === 0 && !r.error, `执行失败，详见 ${join(out, log)}`);
  return r.stdout;
}
const dc = (args, options) => command([...compose, ...args], options);
const sql = (text) =>
  dc(
    [
      "exec",
      "-T",
      "mysql",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
    ],
    { input: text, log: "last-query.log" },
  );
const version = () =>
  sql(
    "SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank;",
  ).trim();
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
        sql(
          `SELECT ${snapshotFields(table, fields)} FROM ${table}${table === "sys_entry" ? ` WHERE id<=${limit}` : ""} ORDER BY ${fields.startsWith("id,") ? "id" : fields};`,
        ),
      ),
    ]),
  );
function mark(text) {
  result.checks.push(text);
  console.log("通过：" + text);
}
let stopped = false;
try {
  assert.equal(
    version(),
    readFileSync(join(passed.path, "source-migrations.txt"), "utf8").trim(),
    "日常迁移版本已变化，请重新隔离验收",
  );
  result.oldImages = {};
  for (const service of ["backend", "frontend"]) {
    const container = dc(["ps", "-q", service]).trim();
    assert(container, service + " 尚未运行");
    const image = command([
      "inspect",
      "--format",
      "{{.Image}}",
      container,
    ]).trim();
    const tag = `mayday-${service}:before-${id}`;
    command(["tag", image, tag]);
    result.oldImages[service] = { image, tag };
  }
  dc(["build", "backend", "frontend"], { log: "build.log" });
  mark("前后端镜像构建及旧镜像保留");
  dc(["stop", "backend", "frontend"], { log: "stop.log" });
  stopped = true;
  const limit = Number(
    sql("SELECT COALESCE(MAX(id),0) FROM sys_entry;").trim(),
  );
  assert(Number.isSafeInteger(limit));
  const before = snapshot(limit);
  writeFileSync(join(out, "before.json"), JSON.stringify(before, null, 2));
  const oldCrawlerMenu = readCrawlerMenu(sql);
  const dump = dc(
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
  assert(dump.includes("flyway_schema_history"));
  writeFileSync(join(out, "before.sql"), dump);
  result.backup = {
    path: join(out, "before.sql"),
    sha256: hash(dump),
    bytes: Buffer.byteLength(dump),
  };
  mark("停写后的完整数据库备份");
  dc(
    [
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "180",
      "backend",
      "frontend",
    ],
    { log: "start.log" },
  );
  assert.equal(
    version(),
    readFileSync(join(passed.path, "upgrade-migrations.txt"), "utf8").trim(),
    "实际迁移与隔离验收不一致",
  );
  mark("实际迁移与已通过验收一致");
  assert.deepEqual(
    snapshot(limit),
    before,
    "原有业务字段或角色授权发生非预期变化",
  );
  mark("原有账号、权限、组织和内容字段保持一致");
  verifyCrawlerMenuRename(oldCrawlerMenu, readCrawlerMenu(sql));
  mark("内置采集菜单按预期改名，自定义名称保留");
  result.status = "passed";
  mark("前后端与数据库服务已启动");
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  result.businessWasStopped = stopped;
  process.exitCode = 1;
  console.error(error.message);
  console.error(
    "保留备份和旧镜像，按 docs/upgrade.md 检查；不会自动删库或覆盖回退。",
  );
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log("升级记录：" + join(out, "result.json"));
}
