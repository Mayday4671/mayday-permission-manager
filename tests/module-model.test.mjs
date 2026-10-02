import test from "node:test";
import assert from "node:assert/strict";
import { pageEnabled } from "../frontend/src/lib/module-model.ts";

test("关闭功能的页面和设计器不能从恢复页签或直接地址进入", () => {
  const disabled = {
    content: false,
    portal: false,
    approvals: false,
    crawler: false,
    notifications: false,
    udp: false,
    workorders: false,
  };
  for (const path of [
    "/admin/site-settings",
    "/admin/notices",
    "/admin/workflows/designer",
    "/admin/workflows/123/design",
    "/admin/tasks",
    "/admin/messages",
    "/admin/crawler",
    "/admin/workorders",
  ])
    assert.equal(pageEnabled(path, disabled), false, path);
  assert.equal(pageEnabled("/admin/users", disabled), true);
  assert.equal(pageEnabled("/admin/profile", disabled), true);
  assert.equal(pageEnabled("/admin/workorders", { workorders: true }), true);
});
