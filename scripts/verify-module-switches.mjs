/** 在基线创建的独立数据库启动裁剪实例，检查真实 HTTP、管理员权限、导航和模块依赖。 */
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.env.API_TEST_COMPOSE_PROJECT;
assert.match(
  project ?? "",
  /^mayday-check-[a-z0-9-]+$/,
  "只能在独立基线项目运行模块裁剪验收",
);
const port = process.env.VERIFY_MODULE_PORT ?? "18083";
assert.match(port, /^\d{4,5}$/);
const container = `${project}-module-switches`;
const base = `http://127.0.0.1:${port}/api`;
function docker(args) {
  const response = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
  });
  if (response.status !== 0 || response.error)
    throw new Error("独立模块验收容器操作失败", { cause: response.error });
  return response.stdout;
}
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
const profiles = [
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

for (const profile of profiles) {
  let created = false;
  let token;
  try {
    docker([
      "compose",
      "-p",
      project,
      "-f",
      join(root, "compose.verify.yaml"),
      "run",
      "--no-deps",
      "-d",
      "--name",
      container,
      "-p",
      `127.0.0.1:${port}:8080`,
      ...Object.entries(profile.flags).flatMap(([key, value]) => [
        "-e",
        `MODULE_${key}_ENABLED=${value}`,
      ]),
      "backend-fresh",
    ]);
    created = true;
    let healthy = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      healthy = await fetch(`http://127.0.0.1:${port}/actuator/health`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (healthy) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    assert.ok(healthy, "裁剪配置无法正常启动");
    const state = await request("/platform/features");
    assert.equal(state.modules.portal, false);
    assert.equal(state.modules.approvals, false);
    assert.equal(state.modules.feedback, false);
    assert.equal(state.modules.content, profile.content);
    token = (
      await loginWithCaptcha(base, "admin", process.env.VERIFY_ADMIN_PASSWORD)
    ).token;
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
    console.log(`通过模块开关：${profile.name}`);
  } finally {
    if (token) await request("/auth/logout", token, 200, "POST");
    if (created) docker(["rm", "-f", container]);
  }
}
