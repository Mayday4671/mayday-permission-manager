/**
 * 数据库交付校验：唯一字段说明源为 database/mayday.sql 中的中文 COMMENT。
 * node scripts/database-docs.mjs --check：只读数据库元数据，不读取业务内容或输出口令。
 * 不再生成分散的字典或参考文件；历史文件名保留以兼容既有验证脚本。
 * 隔离验收直接复用 verifyDatabaseComments(query)，避免对日常库执行变更。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parse = (text) =>
  text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
/** 只解析本项目 SHOW CREATE 格式的业务建表语句；不执行 SQL，也不读取业务数据。 */
function documentedSchema() {
  const source = readFileSync(
    resolve(root, "database/mayday.sql"),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const unquote = (value) =>
    value.replace(/''/g, "'").replace(/\\(['\\])/g, "$1");
  const tables = {};
  const create =
    /CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=[^;]+COMMENT='((?:[^'\\]|\\.|'')*)';/g;
  for (const [, name, body, comment] of source.matchAll(create)) {
    const columns = {};
    for (const line of body.split("\n")) {
      if (!/^\s*`/.test(line)) continue;
      const column = line.match(
        /^\s*`([^`]+)` .* COMMENT '((?:[^'\\]|\\.|'')*)',?$/,
      );
      assert(column, `${name} 的字段必须包含完整中文 COMMENT：${line.trim()}`);
      assert(column[2].trim(), `${name}.${column[1]} 注释不能为空`);
      columns[column[1]] = unquote(column[2]);
    }
    assert(Object.keys(columns).length, `${name} 缺少字段说明`);
    assert(comment.trim(), `${name} 缺少表说明`);
    tables[name] = { comment: unquote(comment), columns };
  }
  assert(Object.keys(tables).length, "初始化 SQL 未包含业务表");
  return tables;
}
export function readDatabaseMetadata(query) {
  const tableRows = parse(
    query(
      "SELECT JSON_OBJECT('name',table_name,'comment',table_comment) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name <> 'flyway_schema_history' ORDER BY table_name;",
    ),
  );
  const columnRows = parse(
    query(
      "SELECT JSON_OBJECT('table',table_name,'name',column_name,'type',column_type,'nullable',is_nullable,'default',column_default,'extra',extra,'comment',column_comment,'collation',collation_name) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name <> 'flyway_schema_history' ORDER BY table_name,ordinal_position;",
    ),
  );
  return tableRows.map((table) => ({
    ...table,
    columns: columnRows.filter((c) => c.table === table.name),
  }));
}
export function verifyDatabaseComments(query) {
  const tables = documentedSchema();
  const schema = readDatabaseMetadata(query);
  assert.deepEqual(
    schema.map((t) => t.name).sort(),
    Object.keys(tables).sort(),
    "表目录与数据库不一致",
  );
  for (const table of schema) {
    assert.equal(
      table.comment,
      tables[table.name].comment,
      `${table.name} 表注释不一致`,
    );
    for (const column of table.columns) {
      const expected = tables[table.name].columns[column.name];
      assert(expected, `${table.name}.${column.name} 缺少文档`);
      assert.equal(
        column.comment,
        expected,
        `${table.name}.${column.name} 字段注释不一致`,
      );
    }
    for (const key of Object.keys(tables[table.name].columns))
      assert(
        table.columns.some((c) => c.name === key),
        `${table.name}.${key} 文档字段不存在`,
      );
  }
  return schema;
}
// 除去 COMMENT 后比较所有列结构；字段类型、NULL、默认值、自增和字符排序规则均不得被注释迁移改变。
export const structuralColumns = (schema) =>
  schema.map((t) => ({
    name: t.name,
    columns: t.columns.map(({ comment, ...column }) => column),
  }));

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(
    process.argv[2],
    "--check",
    "使用 --check；数据库交付内容统一在 database/mayday.sql 维护",
  );
  const query = (sql) => {
    const r = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        root,
        "-f",
        resolve(root, "compose.yaml"),
        "exec",
        "-T",
        "mysql",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
      ],
      {
        input: sql,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.equal(r.status, 0, "读取数据库元数据失败；请检查本机 MySQL 服务");
    return r.stdout;
  };
  const schema = verifyDatabaseComments(query);
  console.log(
    JSON.stringify({
      status: "passed",
      tables: schema.length,
      columns: schema.reduce((n, t) => n + t.columns.length, 0),
    }),
  );
}
