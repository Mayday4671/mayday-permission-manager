/** 隔离 API 验收只撤销本测试推进的单例元数据；业务列从不由 SQL 恢复覆盖。 */
import {
  isolatedSql,
  isolatedComposeArguments,
  assertIsolatedDatabaseBinding,
} from "./isolated-compose.mjs";

const allowedTables = new Set(["udp_relay_config", "ops_monitor_policy"]);
const snapshots = new WeakMap();
const schemaFields = [
  "COLUMN_NAME",
  "COLUMN_TYPE",
  "IS_NULLABLE",
  "EXTRA",
  "GENERATION_EXPRESSION",
  "CHARACTER_SET_NAME",
  "COLLATION_NAME",
  "COLUMN_DEFAULT",
];
const metadata = new Set(["version", "updated_at"]);
const guard = "`mayday_singleton_fixture_guard`";

function fail(message) {
  throw new Error("单例夹具：" + message);
}

function run(query, statement, environment) {
  let result;
  try {
    result = query(statement, { raw: true, environment });
  } catch {
    fail("隔离 SQL 执行失败");
  }
  if (typeof result !== "string") fail("隔离 SQL 返回格式无效");
  return result;
}

function lines(result) {
  return result.replace(/(?:\r?\n)+$/, "").split(/\r?\n/);
}

function identifier(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9_]*$/.test(name))
    fail("列名不可信");
  return "`" + name + "`";
}

function hex(value) {
  if (value === "NULL") return null;
  if (!/^(?:[0-9A-F]{2})*$/.test(value)) fail("列编码无效");
  return value;
}

function decode(value) {
  if (value === null) fail("必需列不能为空");
  const decoded = Buffer.from(value, "hex").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("hex").toUpperCase() !== value)
    fail("列编码无效");
  return decoded;
}

function decimalVersion(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail("版本格式无效");
    return String(value);
  }
  if (typeof value === "bigint") {
    if (value < 0n) fail("版本格式无效");
    return String(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value))
    return value;
  fail("版本格式无效");
}

function binding(query, environment) {
  let compose;
  try {
    compose = isolatedComposeArguments(environment);
  } catch {
    fail("隔离项目绑定无效");
  }
  const actual = run(query, "SELECT DATABASE();", environment).replace(
    /(?:\r?\n)+$/,
    "",
  );
  try {
    assertIsolatedDatabaseBinding(actual, environment);
  } catch {
    fail("隔离数据库绑定无效");
  }
  return JSON.stringify([compose, environment.API_TEST_DATABASE, actual]);
}

function schemaQuery(table) {
  return (
    "SELECT " +
    schemaFields
      .map((field) => `IF(${field} IS NULL,'NULL',HEX(${field}))`)
      .join(",") +
    ",ORDINAL_POSITION FROM information_schema.COLUMNS " +
    "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" +
    table +
    "' ORDER BY ORDINAL_POSITION;"
  );
}

function readSchema(table, query, environment) {
  const result = lines(run(query, schemaQuery(table), environment));
  const columns = result.map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== schemaFields.length + 1) fail("表结构返回格式无效");
    const fields = cells.slice(0, -1).map(hex);
    const name = decode(fields[0]);
    identifier(name);
    if (cells.at(-1) !== String(index + 1)) fail("列顺序无效");
    return Object.freeze({ name, fields: Object.freeze(fields) });
  });
  const names = new Set(columns.map((column) => column.name));
  if (
    names.size !== columns.length ||
    !["id", "version", "created_at", "updated_at"].every((name) =>
      names.has(name),
    ) ||
    (table === "ops_monitor_policy" && !names.has("last_alert_at"))
  )
    fail("表结构缺少必需列或存在重复列");
  if (
    columns.some(
      (column) =>
        decode(column.fields[3]) !== "" &&
        /GENERATED/i.test(decode(column.fields[3])),
    )
  )
    fail("表结构包含不支持的生成列");
  return Object.freeze(columns);
}

function readEngine(table, query, environment) {
  const result = run(
    query,
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() " +
      `AND TABLE_NAME='${table}';`,
    environment,
  ).replace(/(?:\r?\n)+$/, "");
  if (result !== "InnoDB") fail("单例表必须使用 InnoDB");
}

function encodedColumn(name) {
  const column = identifier(name);
  // 字符列的默认排序规则可能忽略大小写及尾空格；HEX(CAST AS BINARY) 保留实际字节。
  // SQL NULL 必须与空字节串区分，所有业务字段及元数据都进入同一比较条件。
  return `IF(${column} IS NULL,NULL,HEX(CAST(${column} AS BINARY)))`;
}

function rowQuery(table, columns) {
  return (
    "SELECT " +
    columns
      .map((column) => `IFNULL(${encodedColumn(column.name)},'NULL')`)
      .join(",") +
    ` FROM ${identifier(table)} WHERE \`id\`=1;`
  );
}

function parseRow(result, columns) {
  const rows = lines(result);
  if (rows.length !== 1) fail("固定单例记录缺失或不唯一");
  const cells = rows[0].split("\t");
  if (cells.length !== columns.length) fail("单例行返回列数无效");
  const values = Object.freeze(cells.map(hex));
  if (values[columns.findIndex((column) => column.name === "id")] !== "31")
    fail("单例主键必须为 1");
  return values;
}

function valueAt(state, name) {
  return state.values[
    state.columns.findIndex((column) => column.name === name)
  ];
}

function stateOf(snapshot) {
  const state = snapshots.get(snapshot);
  if (!state) fail("快照来源无效");
  return state;
}

function literal(value) {
  return value === null ? "NULL" : "'" + value + "'";
}

function rowPredicate(columns, values) {
  return columns
    .map(
      (column, index) =>
        `${encodedColumn(column.name)} <=> ${literal(values[index])}`,
    )
    .join(" AND ");
}

function schemaPredicate(columns) {
  return columns
    .map(
      (column, index) =>
        "(ORDINAL_POSITION=" +
        (index + 1) +
        " AND " +
        schemaFields
          .map(
            (field, fieldIndex) =>
              `IF(${field} IS NULL,NULL,HEX(${field})) <=> ${literal(column.fields[fieldIndex])}`,
          )
          .join(" AND ") +
        ")",
    )
    .join(" OR ");
}

function schemaGuard(table, columns) {
  // 动态采集全部列，新增字段也受保护；两次守卫同时比对类型、默认值、空值及字符排序规则。
  // 写入前拒绝结构变化，写入后在事务的表元数据锁内再复核，避免只检查既知字段。
  return (
    `INSERT INTO ${guard} (ok) SELECT IF(COUNT(*)=${columns.length} AND ` +
    `COALESCE(SUM(IF(${schemaPredicate(columns)},1,0)),0)=${columns.length},1,0) ` +
    "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() " +
    `AND TABLE_NAME='${table}';`
  );
}

function engineGuard(table) {
  return (
    `INSERT INTO ${guard} (ok) SELECT IF(COUNT(*)=1 AND ` +
    "COALESCE(SUM(IF(ENGINE='InnoDB',1,0)),0)=1,1,0) " +
    "FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() " +
    `AND TABLE_NAME='${table}';`
  );
}

/** 快照只来自已核验的本轮隔离库；完整列和值深度冻结，不执行写入。 */
export function captureSingletonFixture(
  table,
  { query = isolatedSql, environment = process.env } = {},
) {
  if (!allowedTables.has(table)) fail("不允许此单例表");
  const target = binding(query, environment);
  readEngine(table, query, environment);
  const columns = readSchema(table, query, environment);
  const values = parseRow(
    run(query, rowQuery(table, columns), environment),
    columns,
  );
  const state = { table, target, columns, values };
  const version = decimalVersion(decode(valueAt(state, "version")));
  const snapshot = Object.freeze({ table, id: 1, columns, values, version });
  snapshots.set(snapshot, Object.freeze({ ...state, version }));
  return snapshot;
}

/** SQL 初始版本须与测试首次取得的 API 版本一致。 */
export function assertSingletonFixtureVersion(snapshot, version) {
  if (stateOf(snapshot).version !== decimalVersion(version))
    fail("API 与 SQL 初始版本不一致");
}

/** 只撤销本测试最后成功 API 恢复所推进的元数据，不吸收或覆盖外界变更。 */
export function restoreSingletonFixture(
  snapshot,
  { version, query = isolatedSql, environment = process.env } = {},
) {
  const original = stateOf(snapshot);
  const ownedVersion = decimalVersion(version);
  if (binding(query, environment) !== original.target)
    fail("快照不能跨隔离项目恢复");
  readEngine(original.table, query, environment);
  const columns = readSchema(original.table, query, environment);
  if (JSON.stringify(columns) !== JSON.stringify(original.columns))
    fail("单例表结构已变化");
  const values = parseRow(
    run(query, rowQuery(original.table, columns), environment),
    columns,
  );
  const current = { columns, values };
  const currentVersion = decimalVersion(decode(valueAt(current, "version")));
  if (currentVersion !== ownedVersion)
    fail("本测试 API 版本与当前 SQL 版本不一致");
  if (BigInt(currentVersion) < BigInt(original.version))
    fail("单例版本不能倒退");
  for (let index = 0; index < columns.length; index++) {
    if (
      !metadata.has(columns[index].name) &&
      values[index] !== original.values[index]
    )
      fail("业务列已变化：" + columns[index].name);
  }
  if (
    currentVersion === original.version &&
    valueAt(current, "updated_at") !== valueAt(original, "updated_at")
  )
    fail("未推进版本却改变修改时间");
  const changed = currentVersion !== original.version;
  const count = changed ? 1 : 0;
  const assignment = (name) =>
    `${identifier(name)}=${valueAt(original, name) === null ? "NULL" : "CONVERT(X'" + valueAt(original, name) + "' USING utf8mb4)"}`;
  // mysql batch 不使用 --force：CHECK 失败会中断连接，未提交事务随连接关闭回滚。
  // 临时表先创建；ROW_COUNT 紧接 UPDATE 保存，避免被守卫自身 INSERT 改写。
  // 版本已推进应恰好修改一行；完整无变化应为零行，两种情况都必须通过提交前全行核对。
  // 首次读固定表取得事务级元数据锁后再确认 InnoDB，防止写前换成不能回滚的存储引擎。
  const statement = [
    `CREATE TEMPORARY TABLE ${guard} (ok TINYINT NOT NULL CHECK (ok=1));`,
    "START TRANSACTION;",
    `SELECT \`id\` INTO @mayday_singleton_fixture_id FROM ${identifier(original.table)} WHERE \`id\`=1 FOR UPDATE;`,
    `INSERT INTO ${guard} (ok) SELECT IF(HEX(DATABASE())='6D61796461795F766572696679',1,0);`,
    engineGuard(original.table),
    schemaGuard(original.table, columns),
    `UPDATE ${identifier(original.table)} SET ${assignment("version")},${assignment("updated_at")} WHERE ${rowPredicate(columns, values)};`,
    "SET @mayday_singleton_fixture_changed=ROW_COUNT();",
    `INSERT INTO ${guard} (ok) VALUES (IF(@mayday_singleton_fixture_changed=${count},1,0));`,
    `INSERT INTO ${guard} (ok) SELECT IF(COUNT(*)=1 AND COALESCE(SUM(IF(${rowPredicate(columns, original.values)},1,0)),0)=1,1,0) FROM ${identifier(original.table)} WHERE \`id\`=1;`,
    schemaGuard(original.table, columns),
    engineGuard(original.table),
    `INSERT INTO ${guard} (ok) SELECT IF(HEX(DATABASE())='6D61796461795F766572696679',1,0);`,
    "SELECT @mayday_singleton_fixture_changed;",
    rowQuery(original.table, columns),
    "COMMIT;",
  ].join("\n");
  const restored = lines(run(query, statement, environment));
  if (restored.length !== 2 || restored[0] !== String(count))
    fail("恢复修改行数无效");
  const restoredValues = parseRow(restored[1], columns);
  if (!restoredValues.every((value, index) => value === original.values[index]))
    fail("恢复后完整单例行不一致");
  return Object.freeze({ table: original.table, id: 1, changed });
}
