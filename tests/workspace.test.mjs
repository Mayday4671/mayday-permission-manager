import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTabs,
  closeTabs,
} from "../frontend/src/lib/workspace-model.ts";

const home = "/admin";
const users = "/admin/users";
const roles = "/admin/roles";
const logs = "/admin/logs";
const paths = [home, users, roles, logs];

test("恢复页签会去重，丢弃无权访问的页面、外部地址及损坏值", () => {
  assert.deepEqual(
    normalizeTabs(
      [users, users, logs, "https://example.com", null, 12],
      [home, users],
      home,
    ),
    [home, users],
  );
  assert.deepEqual(normalizeTabs({ path: users }, [home, users], home), [home]);
});
test("权限撤回后以个人中心替代固定工作台", () => {
  assert.deepEqual(
    normalizeTabs(paths, [users, "/admin/profile"], "/admin/profile"),
    ["/admin/profile", users],
  );
});
test("关闭活动页选择右邻页，关闭末页回到左邻页", () => {
  assert.deepEqual(closeTabs(paths, users, users, home, "current"), {
    paths: [home, roles, logs],
    active: roles,
  });
  assert.equal(closeTabs(paths, logs, logs, home, "current").active, roles);
});
test("关闭非活动页不打断当前页面，固定首页无法关闭", () => {
  assert.equal(closeTabs(paths, users, roles, home, "current").active, roles);
  assert.deepEqual(closeTabs(paths, home, home, home, "current"), {
    paths,
    active: home,
  });
});
test("右键关闭其他页签保留目标页及固定首页", () => {
  assert.deepEqual(closeTabs(paths, roles, users, home, "others"), {
    paths: [home, roles],
    active: roles,
  });
});
test("关闭右侧页签后活动页回退至保留页", () => {
  assert.deepEqual(closeTabs(paths, users, logs, home, "right"), {
    paths: [home, users],
    active: users,
  });
});
test("关闭全部后回到固定首页", () => {
  assert.deepEqual(closeTabs(paths, roles, roles, home, "all"), {
    paths: [home],
    active: home,
  });
});
