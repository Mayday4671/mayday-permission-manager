import assert from "node:assert/strict";
import test from "node:test";
import {
  readPageSize,
  readDensity,
  readHiddenColumns,
  preferenceKey,
  readSavedQueries,
  validPage,
} from "../frontend/src/lib/list-preferences.ts";
import { createLeaveGuards } from "../frontend/src/lib/leave-guards.ts";

test("常用查询仅恢复允许的筛选字段，不能恢复接口、角色或数据范围", () => {
  const input = [
    {
      id: "1",
      name: " 停用账号 ",
      keyword: " alice ",
      status: false,
      extra: {
        departmentId: 2,
        endpoint: "/auth/me",
        roleIds: [1],
        dataScope: "ALL",
        page: 999,
      },
    },
  ];
  assert.deepEqual(readSavedQueries(input, ["departmentId"]), [
    {
      id: "1",
      name: "停用账号",
      keyword: "alice",
      status: false,
      extra: { departmentId: 2 },
    },
  ]);
});
test("损坏、重复、过量查询和超长字段被限制，原型键不能注入", () => {
  assert.deepEqual(readSavedQueries({}, []), []);
  const source = [
    { id: "", name: "invalid" },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: "查".repeat(40),
      keyword: "x".repeat(300),
      extra: JSON.parse('{"__proto__":{"admin":true},"status":false}'),
    })),
  ];
  const result = readSavedQueries(source, ["__proto__", "status"]);
  assert.equal(result.length, 8);
  assert.equal(result[0].name.length, 24);
  assert.equal(result[0].keyword.length, 200);
  assert.deepEqual(result[0].extra, { status: false });
  assert.equal(readSavedQueries([result[0], result[0]], []).length, 1);
});
test("表格偏好按账号、页面、嵌套资源隔离；损坏密度安全回退", () => {
  const keys = new Set([
    preferenceKey(1, "/admin/users", "table"),
    preferenceKey(2, "/admin/users", "table"),
    preferenceKey(1, "/admin/roles", "table"),
    preferenceKey(1, "/admin/users", "detail.table"),
  ]);
  assert.equal(keys.size, 4);
  assert.equal(readDensity("wide"), "middle");
  assert.equal(readDensity("small"), "small");
  assert.equal(readPageSize(999999), 10);
  assert.equal(readPageSize(50), 50);
  assert.deepEqual(
    readHiddenColumns(["email", "email", false, {}, "x".repeat(200)]),
    ["email"],
  );
});
test("总数缩水后直接回到最后合法页，空结果回第一页", () => {
  assert.equal(validPage(99, 10, 11), 2);
  assert.equal(validPage(50, 20, 0), 1);
  assert.equal(validPage(2, 10, 25), 2);
});
test("多个编辑器分别注册，后注册者先确认，取消不覆盖其他保护", async () => {
  const guards = createLeaveGuards(),
    calls = [];
  guards.register({
    active: () => true,
    confirm: async () => {
      calls.push("page");
      return true;
    },
  });
  const remove = guards.register({
    active: () => true,
    confirm: async () => {
      calls.push("modal");
      return false;
    },
  });
  assert.equal(await guards.confirm(), false);
  assert.deepEqual(calls, ["modal"]);
  remove();
  assert.equal(await guards.confirm(), true);
  assert.deepEqual(calls, ["modal", "page"]);
});
test("并发离开复用确认，无修改的编辑器不弹窗", async () => {
  const guards = createLeaveGuards();
  guards.register({
    active: () => false,
    confirm: async () => {
      assert.fail("不应确认");
    },
  });
  assert.equal(guards.active(), false);
  let resolve;
  guards.register({
    active: () => true,
    confirm: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const first = guards.confirm(),
    second = guards.confirm();
  assert.equal(first, second);
  resolve(true);
  assert.equal(await first, true);
});
