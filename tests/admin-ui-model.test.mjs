import assert from "node:assert/strict";
import test from "node:test";
import { changePermission } from "../frontend/src/lib/permission-selection.ts";
import {
  groupTableRows,
  fitTableWidths,
} from "../frontend/src/lib/table-model.ts";

const all = () => true;
test("岗位、文件和菜单列宽在普通桌面容器内按需收缩，操作列保持完整", () => {
  const cases = [
    {
      preferred: [56, 230, 260, 100, 170, 100],
      min: [56, 112, 80, 80, 120, 100],
    },
    {
      preferred: [56, 216, 88, 96, 156, 100],
      min: [56, 112, 80, 80, 120, 100],
    },
    {
      preferred: [56, 230, 170, 170, 80, 100, 100],
      min: [56, 170, 84, 84, 80, 80, 100],
    },
  ];
  for (const { preferred, min } of cases) {
    for (const width of [734, 1000, 1280, 2000]) {
      const fit = fitTableWidths(preferred, min, width);
      assert.equal(fit.overflow, false);
      assert.ok(fit.widths.reduce((sum, item) => sum + item, 0) <= width);
      assert.equal(fit.widths.at(-1), 100);
      fit.widths.forEach((item, i) => assert.ok(item >= min[i]));
    }
  }
});
test("真正放不下的窄容器保留最小可读宽度，不裁掉操作按钮", () => {
  const fit = fitTableWidths([56, 216, 156, 100], [56, 112, 120, 100], 300);
  assert.equal(fit.overflow, true);
  assert.deepEqual(fit.widths, [56, 112, 120, 100]);
});
test("选择字段修改权限补齐读取和模块查看，并保留其他模块的原有授权", () => {
  assert.deepEqual(
    new Set(changePermission(["notices:view"], "users:email-write", true, all)),
    new Set([
      "notices:view",
      "users:email-write",
      "users:email-read",
      "users:view",
    ]),
  );
});
test("取消读取权限撤销依赖的写权限；取消用户查看同时撤销用户统计", () => {
  assert.deepEqual(
    changePermission(
      ["users:view", "users:email-read", "users:email-write", "notices:view"],
      "users:email-read",
      false,
      all,
    ),
    ["users:view", "notices:view"],
  );
  assert.deepEqual(
    changePermission(
      ["users:view", "users:create", "userstats:view", "notices:view"],
      "users:view",
      false,
      all,
    ),
    ["notices:view"],
  );
});
test("模块批量操作不允许授予本人无权授予的操作或依赖权限", () => {
  const can = (key) =>
    ["users:view", "users:create", "users:email-write"].includes(key);
  let value = ["notices:view"];
  for (const key of [
    "users:view",
    "users:create",
    "users:delete",
    "users:email-write",
  ])
    value = changePermission(value, key, true, can);
  assert.deepEqual(value, ["notices:view", "users:view", "users:create"]);
});
test("切换模块时其他权限不丢失，清空一个模块不会全局清空", () => {
  const selected = [
    "dashboard:view",
    "users:view",
    "users:create",
    "notices:view",
    "notices:publish",
  ];
  const cleared = ["users:create", "users:view"].reduce(
    (value, key) => changePermission(value, key, false, all),
    selected,
  );
  assert.deepEqual(cleared, [
    "dashboard:view",
    "notices:view",
    "notices:publish",
  ]);
});
test("菜单按侧栏目录分组并遵循排序，目录没有业务记录，子行保持真实 ID", () => {
  const rows = [
    { id: 3, group: "系统管理", sortOrder: 2 },
    { id: 2, group: "工作空间", sortOrder: 5 },
    { id: 1, group: "工作空间", sortOrder: 1 },
  ];
  const tree = groupTableRows(rows, (row) => row.group);
  assert.deepEqual(
    tree.map((row) => row.label),
    ["工作空间", "系统管理"],
  );
  assert.equal(tree[0].record, undefined);
  assert.deepEqual(
    tree[0].children.map((row) => [row.sequence, row.record.id]),
    [
      ["1.1", 1],
      ["1.2", 2],
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [3, 2, 1],
  );
});
test("菜单搜索结果仍归属目录，空结果不会产生空的虚拟菜单", () => {
  assert.deepEqual(
    groupTableRows([], () => "系统管理"),
    [],
  );
  const tree = groupTableRows([{ id: 25 }], () => "系统管理");
  assert.equal(tree[0].label, "系统管理");
  assert.equal(tree[0].children[0].record.id, 25);
});
