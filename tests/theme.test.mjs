/** 真实数据库主题契约与权限测试。和安全专项一样，只能在独立 Compose 验收项目执行。 */
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { spawnSync } from "node:child_process";
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(
    process.env.API_TEST_COMPOSE_PROJECT ?? "",
  ) &&
  ["fresh-db", "upgrade-db"].includes(process.env.API_TEST_DATABASE) &&
  process.env.API_BASE &&
  process.env.ADMIN_PASSWORD;
const base = process.env.API_BASE;
// 测试会修改内置参数，产品不允许删除这些参数；仅在隔离库恢复这两个键的原始行和版本。
// 值用 UTF-8 十六进制传输，避免把站点名称中的引号、反斜线或换行当成 SQL。
const fields = [
  "id",
  "kind",
  "name",
  "code",
  "value",
  "description",
  "permission",
  "path",
  "parent_id",
  "sort_order",
  "enabled",
  "created_at",
  "updated_at",
  "version",
  "leader_id",
  "icon",
  "group_name",
  "value_type",
  "built_in",
];
function sql(statement) {
  assert(isolated, "只允许隔离验收数据库");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      process.env.API_TEST_COMPOSE_PROJECT,
      "-f",
      "compose.verify.yaml",
      "exec",
      "-T",
      process.env.API_TEST_DATABASE,
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw --skip-column-names',
    ],
    {
      input: statement,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, "隔离主题参数快照/清理失败");
  return result.stdout.trim();
}
const hexValue = (value) => {
  if (value === null) return "NULL";
  assert(/^(?:[A-F0-9]{2})*$/.test(value));
  return `CONVERT(UNHEX('${value}') USING utf8mb4)`;
};
async function api(path, token, method = "GET", value, status = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  return (await response.json()).data;
}
test("前台主题权限、校验与一致性", { skip: !isolated }, async (t) => {
  const token = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  const originalRows = sql(
    `SELECT JSON_ARRAY(${fields.map((f) => `HEX(CAST(\`${f}\` AS CHAR CHARACTER SET utf8mb4))`).join(",")}) FROM sys_entry WHERE kind='settings' AND code IN ('site.name','site.theme') ORDER BY id;`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const theme = {
    mode: "dark",
    primaryColor: "#08979c",
    borderRadius: 8,
    compact: true,
  };
  const draft = async (value) => {
    const current = await api("/system/site-config", token);
    return {
      "site.theme": {
        value: JSON.stringify(value),
        version: current.entries.find((e) => e.code === "site.theme")?.version,
      },
    };
  };
  let role, user, viewer;
  try {
    await t.test("匿名只读取公开主题，不能修改配置", async () => {
      const site = await api("/public/site");
      assert.deepEqual(Object.keys(site.theme).sort(), [
        "borderRadius",
        "compact",
        "mode",
        "primaryColor",
      ]);
      await api("/system/site-config", null, "GET", undefined, 401);
      await api("/system/site-config", null, "PUT", await draft(theme), 401);
    });
    await t.test("保存真实主题后公开接口一致，过期版本被拒绝", async () => {
      await api("/system/site-config", token, "PUT", await draft(theme));
      assert.deepEqual((await api("/public/site")).theme, theme);
      const old = await draft(theme);
      await api(
        "/system/site-config",
        token,
        "PUT",
        await draft({ ...theme, primaryColor: "#1677ff" }),
      );
      await api("/system/site-config", token, "PUT", old, 409);
      await api("/system/site-config", token, "PUT", await draft(theme));
    });
    await t.test("网站配置和通用参数接口均拒绝任意CSS及非法值", async () => {
      for (const value of [
        { ...theme, mode: "x" },
        { ...theme, primaryColor: "url(https://example.test)" },
        { ...theme, borderRadius: 17 },
        { ...theme, borderRadius: 1.5 },
        { ...theme, compact: "true" },
        { ...theme, css: "body{}" },
        {},
      ]) {
        await api("/system/site-config", token, "PUT", await draft(value), 400);
      }
      const current = await api("/system/site-config", token);
      const entry = current.entries.find((e) => e.code === "site.theme");
      await api(
        `/system/entries/settings/${entry.id}`,
        token,
        "PUT",
        { ...entry, value: JSON.stringify({ ...theme, css: "body{}" }) },
        400,
      );
      assert.deepEqual((await api("/public/site")).theme, theme);
    });
    await t.test("混合保存失败整体回滚，不覆盖站点文本", async () => {
      const current = await api("/system/site-config", token);
      const name = current.entries.find((e) => e.code === "site.name");
      await api(
        "/system/site-config",
        token,
        "PUT",
        {
          "site.name": { value: "不应被保存", version: name?.version },
          ...(await draft({ ...theme, compact: "bad" })),
        },
        400,
      );
      assert.equal(
        (await api("/system/site-config", token)).preview["site.name"],
        current.preview["site.name"],
      );
    });
    await t.test("只有查看权限的账号可预览、不可保存主题", async () => {
      const stamp = Date.now();
      role = await api("/system/roles", token, "POST", {
        name: "主题只读验收",
        code: `theme_${stamp}`,
        enabled: true,
        sortOrder: 0,
        permissions: ["settings:view"],
        dataScopes: { users: "SELF", notices: "SELF" },
      });
      user = await api("/system/users", token, "POST", {
        username: `theme_${stamp}`,
        nickname: "主题只读验收",
        password: "Theme_Validation_2026!",
        enabled: true,
        roleIds: [role.id],
      });
      viewer = (
        await loginWithCaptcha(base, user.username, "Theme_Validation_2026!")
      ).token;
      assert((await api("/system/site-config", viewer)).preview["site.theme"]);
      await api("/system/site-config", viewer, "PUT", await draft(theme), 403);
    });
    await t.test("保存站点文本不会重置已配置的主题", async () => {
      const current = await api("/system/site-config", token);
      const entry = current.entries.find((e) => e.code === "site.name");
      await api("/system/site-config", token, "PUT", {
        "site.name": {
          value: current.preview["site.name"],
          version: entry?.version,
        },
      });
      assert.deepEqual((await api("/public/site")).theme, theme);
    });
  } finally {
    if (viewer) await api("/auth/logout", viewer, "POST");
    if (user) await api(`/system/users/${user.id}`, token, "DELETE");
    if (role) await api(`/system/roles/${role.id}`, token, "DELETE");
    // “恢复默认外观”不等于恢复原始数据：原来没有 theme 行时必须移除测试新建行。
    // 同时恢复原有行的版本和时间，供基线核对升级前后业务快照完全一致。
    sql(
      "START TRANSACTION;" +
        originalRows
          .map(
            (row) =>
              `UPDATE sys_entry SET ${fields
                .slice(1)
                .map((field, i) => `\`${field}\`=${hexValue(row[i + 1])}`)
                .join(",")} WHERE id=${hexValue(row[0])} AND kind='settings';`,
          )
          .join("") +
        `DELETE FROM sys_entry WHERE kind='settings' AND code IN ('site.name','site.theme')${originalRows.length ? ` AND id NOT IN (${originalRows.map((row) => hexValue(row[0])).join(",")})` : ""};COMMIT;`,
    );
    await api("/system/site-config/refresh", token, "POST");
    await api("/auth/logout", token, "POST");
  }
});
