/** 工单是生成器产物；只在隔离验收库运行，检查真实 SQL 范围、权限、版本与清理结果。 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE ?? "http://127.0.0.1:18080/api";
const prefix = `gen_${randomBytes(4).toString("hex")}`;
const password = "Generator_Test_2026!";
async function api(path, token, method = "GET", body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${result.message}`);
  return result.data;
}
const login = async (name, secret = password) =>
  (await loginWithCaptcha(base, name, secret)).token;

test("生成的工单模块真实接口与安全回归", async (t) => {
  assert.ok(
    process.env.API_TEST_COMPOSE_PROJECT,
    "必须使用隔离基线环境，禁止向日常数据库写测试数据",
  );
  const admin = await login("admin", process.env.ADMIN_PASSWORD);
  const roles = [],
    users = [],
    records = [];
  try {
    const features = await api("/platform/features");
    assert.equal(features.modules.workorders, true);
    const role = await api("/system/roles", admin, "POST", {
      code: prefix,
      name: "模板测试角色",
      enabled: true,
      permissions: [
        "workorders:view",
        "workorders:create",
        "workorders:update",
        "workorders:delete",
      ],
      dataScopes: { workorders: "SELF" },
      scopeDepartments: [],
    });
    roles.push(role.id);
    const createUser = async (suffix, roleIds) => {
      const user = await api("/system/users", admin, "POST", {
        username: `${prefix}_${suffix}`,
        nickname: suffix,
        password,
        enabled: true,
        roleIds,
        postIds: [],
      });
      users.push(user.id);
      return user;
    };
    const alice = await createUser("alice", [role.id]);
    const bob = await createUser("bob", [role.id]);
    const reader = await createUser("reader", []);
    const aliceToken = await login(alice.username),
      bobToken = await login(bob.username),
      readerToken = await login(reader.username);
    const first = await api("/business/workorders", aliceToken, "POST", {
      title: "Alice 工单",
      description: "说明",
      enabled: true,
      ownerId: bob.id,
      departmentId: 999999,
    });
    records.push(first.id);
    const second = await api("/business/workorders", bobToken, "POST", {
      title: "Bob 工单",
      enabled: true,
    });
    records.push(second.id);
    await t.test(
      "匿名和无授权账号不能访问；服务端创建者不可由请求伪造",
      async () => {
        await api("/business/workorders", null, "GET", undefined, 401);
        await api("/business/workorders", readerToken, "GET", undefined, 403);
        assert.equal(first.ownerId, alice.id);
        assert.equal(first.departmentId, null);
      },
    );
    await t.test(
      "分页查询与直接 ID 读写都遵守 SELF，管理员可见全部",
      async () => {
        const page = await api("/business/workorders?size=1", aliceToken);
        assert.equal(page.total, 1);
        assert.equal(page.items[0].id, first.id);
        await api(
          `/business/workorders/${second.id}`,
          aliceToken,
          "GET",
          undefined,
          403,
        );
        await api(
          `/business/workorders/${second.id}`,
          aliceToken,
          "PUT",
          { title: "越权", enabled: true, version: second.version },
          403,
        );
        await api(
          `/business/workorders/${second.id}?version=${second.version}`,
          aliceToken,
          "DELETE",
          undefined,
          403,
        );
        const result = await api(
          `/business/workorders?keyword=${encodeURIComponent("工单")}`,
          admin,
        );
        assert.ok(result.items.some((item) => item.id === second.id));
      },
    );
    await t.test("校验和版本冲突使用 400/409，不覆盖当前内容", async () => {
      await api(
        "/business/workorders",
        aliceToken,
        "POST",
        { title: " ", enabled: true },
        400,
      );
      await api(
        "/business/workorders",
        aliceToken,
        "POST",
        { title: "测试" },
        400,
      );
      const updated = await api(
        `/business/workorders/${first.id}`,
        aliceToken,
        "PUT",
        { title: "已修改", enabled: false, version: first.version },
      );
      assert.ok(updated.version > first.version);
      await api(
        `/business/workorders/${first.id}`,
        aliceToken,
        "PUT",
        { title: "旧版覆盖", enabled: true, version: first.version },
        409,
      );
      await api(
        `/business/workorders/${first.id}?version=${first.version}`,
        aliceToken,
        "DELETE",
        undefined,
        409,
      );
      assert.equal(
        (await api(`/business/workorders/${first.id}`, aliceToken)).title,
        "已修改",
      );
    });
    await t.test(
      "契约只有管理员可读，生成 DTO 与运行接口一致，未知路径返回 404",
      async () => {
        await api("/platform/openapi", readerToken, "GET", undefined, 403);
        const response = await fetch(base + "/platform/openapi", {
          headers: { Authorization: `Bearer ${admin}` },
        });
        assert.equal(response.status, 200);
        const schema = await response.json();
        assert.ok(schema.paths["/api/business/workorders"].post.requestBody);
        assert.ok(schema.components.schemas.WorkOrderView.properties.ownerId);
        assert.ok(schema.components.schemas.SessionView.properties.permissions);
        await api(
          "/public/not-found-contract-test",
          null,
          "GET",
          undefined,
          404,
        );
      },
    );
  } finally {
    for (const id of records.reverse()) {
      const record = await api(`/business/workorders/${id}`, admin);
      await api(
        `/business/workorders/${id}?version=${record.version}`,
        admin,
        "DELETE",
      );
    }
    for (const id of users.reverse())
      await api(`/system/users/${id}`, admin, "DELETE");
    for (const id of roles.reverse())
      await api(`/system/roles/${id}`, admin, "DELETE");
  }
});
