import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_APPEARANCE,
  PORTAL_APPEARANCE,
  THEME_PRESETS,
  chartColors,
  importAppearance,
  normalizeAppearance,
  themeBackground,
} from "../frontend/src/lib/theme-model.ts";

test("历史四字段主题保留客户选项，新增字段分别使用默认值", () => {
  const theme = normalizeAppearance(
    { mode: "dark", primaryColor: "#ABCDEF", borderRadius: 0, compact: true },
    PORTAL_APPEARANCE,
  );
  assert.deepEqual(theme, {
    ...PORTAL_APPEARANCE,
    mode: "dark",
    primaryColor: "#abcdef",
    borderRadius: 0,
    compact: true,
  });
  assert.equal(
    normalizeAppearance(null, ADMIN_APPEARANCE).contentWidth,
    "full",
  );
});
test("复制与导入完整往返，拒绝未知字段、脚本值、错误类型和超长输入", () => {
  const theme = {
    ...ADMIN_APPEARANCE,
    menuStyle: "dark",
    background: "slate",
    surfaceStyle: "shadow",
    contentWidth: "boxed",
    chartPalette: "soft",
  };
  assert.deepEqual(
    importAppearance(JSON.stringify(theme), PORTAL_APPEARANCE),
    theme,
  );
  assert.equal(
    importAppearance(
      '{"mode":"light","primaryColor":"#ABCDEF","borderRadius":4,"compact":false}',
      PORTAL_APPEARANCE,
    ).primaryColor,
    "#abcdef",
  );
  for (const patch of [
    { css: "body{}" },
    { background: "url(x)" },
    { menuStyle: null },
    { contentWidth: "1000px" },
    { chartPalette: [] },
    { successColor: "#123" },
    { warningColor: "var(--x)" },
    { errorColor: false },
    { compact: "false" },
    { borderRadius: 4.5 },
  ])
    assert.throws(() =>
      importAppearance(
        JSON.stringify({ ...theme, ...patch }),
        ADMIN_APPEARANCE,
      ),
    );
  for (const text of ["null", "[]", "{}", "{", " ".repeat(2001)])
    assert.throws(() => importAppearance(text, ADMIN_APPEARANCE));
});
test("主题预设、背景和图表色板均是安全设计值，前后台默认值独立", () => {
  for (const preset of THEME_PRESETS) {
    const { name, ...patch } = preset;
    const theme = importAppearance(
      JSON.stringify({ ...ADMIN_APPEARANCE, ...patch }),
      ADMIN_APPEARANCE,
    );
    assert.ok(name.length);
    assert.equal(chartColors(theme).length, 6);
    for (const dark of [false, true])
      assert.match(themeBackground(theme, dark), /^#[0-9a-f]{6}$/);
  }
  assert.equal(
    chartColors({ ...ADMIN_APPEARANCE, primaryColor: "#123456" })[0],
    "#123456",
  );
  assert.notEqual(
    chartColors({ ...ADMIN_APPEARANCE, chartPalette: "soft" })[0],
    ADMIN_APPEARANCE.primaryColor,
  );
  assert.notEqual(
    ADMIN_APPEARANCE.primaryColor,
    PORTAL_APPEARANCE.primaryColor,
  );
  assert.ok(
    JSON.stringify(ADMIN_APPEARANCE).length < 500,
    "完整配置符合后端网站参数长度限制",
  );
});
