import assert from "node:assert/strict";

/** 迁移前按旧结构保留全部业务列；只排除明确会自然增长/过期的运维、会话与挑战记录。 */
export function preservedBusinessColumns(schema) {
  const operational = new Set([
    "flyway_schema_history",
    "sys_session",
    "sys_audit_log",
    "sys_change_audit",
    "ops_monitor_sample",
    "ops_job_execution",
    "sys_identity_challenge",
    "sys_realtime_connection",
    "sys_realtime_event",
    "sys_realtime_guard",
    "sys_security_guard",
    "sys_security_rate",
    "sys_security_state",
  ]);
  return Object.fromEntries(
    schema
      .filter((table) => !operational.has(table.name))
      .map((table) => [
        table.name,
        table.columns.map((column) => column.name).join(","),
      ]),
  );
}

/** JSON/HEX 保留列分隔、换行、BLOB 和 NULL；原始旧列不能因新增字段而丢失保留核对。 */
export function snapshotJsonFields(table, fields) {
  const builtin =
    "kind='menus' AND code='crawler' AND path='/admin/crawler' AND name IN ('图片采集','采集数据')";
  return (
    "JSON_ARRAY(" +
    fields
      .split(",")
      .map((field) => {
        assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(field), "业务快照列名不合法");
        const expression =
          table === "sys_entry" && field === "name"
            ? `CASE WHEN ${builtin} THEN '采集数据' ELSE name END`
            : table === "sys_entry" && ["version", "updated_at"].includes(field)
              ? `CASE WHEN ${builtin} THEN NULL ELSE ${field} END`
              : "`" + field + "`";
        return `IF((${expression}) IS NULL,NULL,HEX(CAST((${expression}) AS BINARY)))`;
      })
      .join(",") +
    ")"
  );
}

/** V15 唯一允许修改的旧资料是内置采集菜单名称；其他字段仍进入原始快照，不放宽权限/内容比对。 */
export function snapshotFields(table, fields) {
  if (table !== "sys_entry") return fields;
  const builtin =
    "kind='menus' AND code='crawler' AND path='/admin/crawler' AND name IN ('图片采集','采集数据')";
  return fields
    .split(",")
    .map((field) => {
      if (field === "name")
        return `CASE WHEN ${builtin} THEN '采集数据' ELSE name END AS name`;
      if (field === "version" || field === "updated_at")
        return `CASE WHEN ${builtin} THEN NULL ELSE ${field} END AS ${field}`;
      return field;
    })
    .join(",");
}

/** 被归一化的三个字段单独严格核对，避免将预期菜单改名当作忽略变更的理由。 */
export function readCrawlerMenu(query) {
  const raw = query(
    "SELECT JSON_OBJECT('id',id,'name',name,'version',version,'updated',updated_at) FROM sys_entry WHERE kind='menus' AND code='crawler' AND path='/admin/crawler' ORDER BY id;",
  );
  return raw.trim()
    ? raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}
export function verifyCrawlerMenuRename(before, after) {
  assert.deepEqual(
    before.map((m) => m.id),
    after.map((m) => m.id),
  );
  before.forEach((old, i) => {
    const current = after[i];
    if (old.name === "图片采集") {
      assert.equal(current.name, "采集数据");
      assert.equal(current.version, (old.version ?? 0) + 1);
      assert(current.updated >= old.updated, "菜单更新时间不得倒退");
    } else
      assert.deepEqual(
        current,
        old,
        "自定义菜单名称和已有新版菜单必须保持不变",
      );
  });
}
