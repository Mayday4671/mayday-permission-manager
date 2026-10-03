import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTabs,
  adminRouteTarget,
  normalizeTabTargets,
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

test("后台返回地址只保留流程设计的安全实体 ID，未知参数和不可信地址无法恢复", () => {
  const designer = "/admin/workflow-designer";
  assert.equal(adminRouteTarget(`${designer}?id=23`), `${designer}?id=23`);
  assert.equal(
    adminRouteTarget(
      `${designer}/?id=0023&token=secret&redirect=https://example.com`,
    ),
    `${designer}?id=23`,
  );
  assert.equal(adminRouteTarget(`${users}?token=secret`), users);
  assert.equal(
    adminRouteTarget("/admin/tasks?record=17&token=secret"),
    "/admin/tasks?record=17",
  );
  for (const id of [
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "9007199254740992",
    "23&id=24",
    "%2F%2Fevil.example",
  ])
    assert.equal(adminRouteTarget(`${designer}?id=${id}`), designer);
  for (const target of [
    null,
    {},
    42,
    "https://example.com/admin/users",
    "//example.com/admin/users",
    "/admin/unknown",
    "/admin/users#secret",
    "/admin/../login",
    "/admin\\users",
    "/admin/users\n",
  ])
    assert.equal(adminRouteTarget(target), undefined);
});

test("页签实体目标恢复依旧按开放路径过滤，且不能恢复表单、外链或其他页面", () => {
  const designer = "/admin/workflow-designer";
  const saved = {
    [designer]: `${designer}?id=23&schema=secret`,
    [users]: "https://example.com/admin/users",
    [roles]: `${designer}?id=24`,
    "/admin/profile": "/admin/profile?draft=secret",
  };
  assert.deepEqual(normalizeTabTargets(saved, [home, users, roles, designer]), {
    [designer]: `${designer}?id=23`,
  });
  assert.deepEqual(normalizeTabTargets(saved, [home, users]), {});
  assert.deepEqual(normalizeTabTargets(null, [designer]), {});
  assert.deepEqual(normalizeTabTargets([`${designer}?id=23`], [designer]), {});
});
