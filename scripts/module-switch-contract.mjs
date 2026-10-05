/** 原生和容器共同执行的真实模块裁剪契约；依赖、接口、授权和导航使用同一组断言。 */
import assert from "node:assert/strict";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

export const moduleProfiles = [
  {
    name: "核心裁剪及依赖关闭",
    flags: {
      CONTENT: false,
      PORTAL: true,
      NOTIFICATIONS: false,
      APPROVALS: true,
      CRAWLER: false,
      SCHEDULER: false,
      UDP: false,
      WORKORDERS: false,
      FEEDBACK: false,
    },
    content: false,
    notifications: false,
  },
  {
    name: "保留内容和消息，关闭门户审批采集",
    flags: {
      CONTENT: true,
      PORTAL: false,
      NOTIFICATIONS: true,
      APPROVALS: false,
      CRAWLER: false,
      SCHEDULER: false,
      UDP: false,
      WORKORDERS: false,
      FEEDBACK: false,
    },
    content: true,
    notifications: true,
  },
];

/** 只查询专用验收服务；测试结束撤销本人登录，不修改业务模块开关或数据。 */
export async function verifyModuleProfile(base, password, profile) {
  async function request(path, token, status = 200, method = "GET") {
    const response = await fetch(base + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}`);
    return result.data;
  }

  let token;
  try {
    const state = await request("/platform/features");
    assert.equal(state.modules.portal, false);
    assert.equal(state.modules.approvals, false);
    assert.equal(state.modules.feedback, false);
    assert.equal(state.modules.content, profile.content);
    token = (await loginWithCaptcha(base, "admin", password)).token;
    for (const path of [
      "/public/site",
      "/public/articles",
      "/public/articles/1/files/1",
      "/system/site-config",
      "/operations/workflows",
      "/operations/requests",
      "/operations/requests/1/files/1",
      "/system/entries/approvalcategories",
      "/crawler/tasks",
      "/crawler/tasks/articles",
      "/crawler/tasks/1/images/1",
      "/relay/stats",
      "/operations/scheduler",
      "/business/workorders",
      "/operations/feedback",
    ])
      await request(path, token, 404);
    for (const path of [
      "/crawler/tasks/1/start",
      "/operations/workflows/1/publish",
      "/relay/start",
      "/public/feedback",
      "/public/feedback/track",
    ])
      await request(path, token, 404, "POST");
    await request("/content/notices", token, profile.content ? 200 : 404);
    await request(
      "/operations/messages",
      token,
      profile.notifications ? 200 : 404,
    );
    const session = await request("/auth/me", token);
    assert.equal(session.admin, true);
    for (const prefix of [
      "crawler:",
      "relay:",
      "workflows:",
      "requests:",
      "workorders:",
      "scheduler:",
      "feedback:",
    ])
      assert.equal(
        session.permissions.some((permission) => permission.startsWith(prefix)),
        false,
        prefix,
      );
    const navigation = await request("/system/navigation", token);
    assert.equal(
      navigation.some((item) =>
        [
          "/admin/site-settings",
          "/admin/crawler",
          "/admin/workflows",
          "/admin/workorders",
        ].includes(item.path),
      ),
      false,
    );
    assert.ok(navigation.some((item) => item.path === "/admin/users"));
    const groups = await request("/system/roles/permissions", token);
    assert.equal(
      groups.some((group) =>
        ["crawler", "relay", "requests", "workorders"].includes(group.key),
      ),
      false,
    );
    await request("/system/users", token);
    await request("/operations/files", token);
  } finally {
    if (token) await request("/auth/logout", token, 200, "POST");
  }
}
