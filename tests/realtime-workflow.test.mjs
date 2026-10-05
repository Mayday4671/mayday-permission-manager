/**
 * 实时通知与催办的真实 HTTP/MySQL 验收，仅允许 verify-baseline 的隔离 Docker 数据库。
 * 覆盖 Bearer 头鉴权、收件人隔离、提交后事件、催办限频、超时快照和权限撤销断流。
 * 已发布历史不能通过业务接口删除；清理只对隔离库中的本次精确 ID 执行。
 */
import { isolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = "qa_realtime_" + Date.now().toString(36);
const password = "Realtime_Qa2026!";

async function call(path, token, method = "GET", data, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    status,
    method + " " + path + ": " + result.message,
  );
  return result.data;
}

function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  isolatedSql(statement);
}

async function waitUntil(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("实时/投递状态未在期限内完成");
}

/** 比较原始纳秒时间，允许 MySQL DATETIME(6) 的最多半微秒舍入；不能容忍审批截止时间发生业务变化。 */
function requireSamePersistedTimestamp(actual, expected) {
  const nanoseconds = (value) => {
    const parts =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?$/.exec(value);
    assert(parts, "服务端应返回合法的本地时间戳");
    const milliseconds = Date.parse(parts[1] + "Z");
    assert(Number.isFinite(milliseconds));
    return (
      BigInt(milliseconds) * 1_000_000n +
      BigInt((parts[2] ?? "").padEnd(9, "0"))
    );
  };
  const difference = nanoseconds(actual) - nanoseconds(expected);
  assert(
    difference >= -500n && difference <= 500n,
    `历史截止时间发生变化：${expected} -> ${actual}`,
  );
}

async function stream(token) {
  const controller = new AbortController();
  const response = await fetch(base + "/operations/realtime/stream", {
    headers: { Authorization: "Bearer " + token },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/event-stream/);
  const events = [];
  let closed = false;
  const reader = response.body.getReader();
  const decode = new TextDecoder();
  void (async () => {
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decode.decode(value, { stream: true });
        const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = block.match(/^event:\s*(.*)$/m)?.[1];
          const data = block.match(/^data:\s*(.*)$/m)?.[1];
          if (event && data) events.push({ event, ...JSON.parse(data) });
        }
      }
    } catch {
      // 正常中止和服务端撤销权限均会结束流，闭合状态由 finally 统一观察。
    } finally {
      closed = true;
    }
  })();
  await waitUntil(() => events.some((item) => item.event === "ready"));
  return { events, close: () => controller.abort(), isClosed: () => closed };
}

test("实时推送、催办限频及历史超时快照", { skip: !isolated }, async () => {
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  const made = {
    users: [],
    roles: [],
    notifications: [],
    definitions: [],
    requests: [],
  };
  const streams = [];
  async function account(label, permissions) {
    const role = await call("/system/roles", admin, "POST", {
      name: prefix + label,
      code: prefix + label,
      enabled: true,
      permissions,
      dataScopes: { users: "SELF", notices: "SELF" },
    });
    made.roles.push(role.id);
    const user = await call("/system/users", admin, "POST", {
      username: prefix + label,
      nickname: label,
      enabled: true,
      password,
      roleIds: [role.id],
    });
    made.users.push(user.id);
    return {
      user,
      role,
      token: (await loginWithCaptcha(base, user.username, password)).token,
    };
  }
  try {
    await call(
      "/operations/realtime/stream?token=" + encodeURIComponent(admin),
      undefined,
      "GET",
      undefined,
      401,
    );
    const applicant = await account("applicant", [
      "requests:view",
      "requests:create",
      "requests:remind",
      "messages:view",
    ]);
    const reviewer = await account("reviewer", [
      "requests:view",
      "requests:approve",
      "messages:view",
    ]);
    const outsider = await account("outsider", ["messages:view"]);
    const reviewStream = await stream(reviewer.token),
      outsideStream = await stream(outsider.token);
    streams.push(reviewStream, outsideStream);
    const templates = await call("/operations/workflows/templates", admin);
    assert.equal(templates.length, 3);
    const category =
      (await call("/system/entries/approvalcategories", admin)).items?.[0] ??
      (await call("/system/entries/approvalcategories", admin))[0];
    const schema = {
      fields: [
        {
          id: "memo",
          label: "说明",
          type: "TEXT",
          required: true,
          width: 24,
          maxLength: 100,
        },
      ],
      nodes: [
        {
          id: "review",
          name: "审核",
          type: "APPROVAL",
          source: "USERS",
          assigneeIds: [reviewer.user.id],
          mode: "ALL",
          next: "end",
          readable: ["memo"],
          writable: [],
          actions: ["APPROVE", "REJECT"],
          timeoutMinutes: 120,
        },
        { id: "end", name: "结束", type: "END" },
      ],
      startNodeId: "review",
      applicantType: "ALL",
      applicantIds: [],
      allowSelfApproval: false,
      allowRepeatApproval: false,
      allowWithdraw: true,
    };
    let definition = await call("/operations/workflows", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      categoryId: category.id,
      businessType: "GENERAL",
      schema,
    });
    made.definitions.push(definition.id);
    definition = await call(
      `/operations/workflows/${definition.id}/publish`,
      admin,
      "POST",
      { version: definition.version },
    );
    let request = await call("/operations/requests", applicant.token, "POST", {
      definitionId: definition.id,
      versionId: definition.publishedVersionId,
      title: prefix,
      values: { memo: "仅用于隔离库验收" },
    });
    made.requests.push(request.id);
    assert(request.tasks[0].dueAt);
    const originalDue = request.tasks[0].dueAt;
    await waitUntil(() =>
      reviewStream.events.some(
        (event) =>
          event.event === "changed" && event.topics?.includes("requests"),
      ),
    );
    await waitUntil(() =>
      reviewStream.events.some(
        (event) =>
          event.event === "changed" && event.topics?.includes("messages"),
      ),
    );
    assert.equal(
      outsideStream.events.filter((event) => event.event === "changed").length,
      0,
    );
    assert(
      reviewStream.events.every(
        (event) => !JSON.stringify(event).includes(prefix),
      ),
      "刷新事件不能携带业务正文",
    );
    await call(
      `/operations/requests/${request.id}/remind`,
      reviewer.token,
      "POST",
      { version: request.version },
      403,
    );
    await call(
      `/operations/requests/${request.id}/remind`,
      applicant.token,
      "POST",
      { version: request.version },
    );
    request = await call(`/operations/requests/${request.id}`, applicant.token);
    assert.equal(request.canRemind, false);
    await call(
      `/operations/requests/${request.id}/remind`,
      applicant.token,
      "POST",
      { version: request.version },
      400,
    );
    definition = await call(
      `/operations/workflows/${definition.id}`,
      admin,
      "PUT",
      {
        ...definition,
        schema: {
          ...schema,
          nodes: [{ ...schema.nodes[0], timeoutMinutes: 1 }, schema.nodes[1]],
        },
      },
    );
    definition = await call(
      `/operations/workflows/${definition.id}/publish`,
      admin,
      "POST",
      { version: definition.version },
    );
    requireSamePersistedTimestamp(
      (await call(`/operations/requests/${request.id}`, applicant.token))
        .tasks[0].dueAt,
      originalDue,
    );
    const inbox = await call("/operations/messages?size=100", reviewer.token);
    assert(inbox.items.length >= 1);
    const before = reviewStream.events.length;
    await call(
      `/operations/messages/${inbox.items[0].id}/read`,
      reviewer.token,
      "POST",
    );
    await waitUntil(() =>
      reviewStream.events
        .slice(before)
        .some(
          (event) =>
            event.event === "changed" && event.topics?.includes("messages"),
        ),
    );
    await call(
      `/operations/requests/${request.id}/decision`,
      applicant.token,
      "POST",
      { version: request.version, action: "WITHDRAW" },
    );
    await call(`/system/roles/${reviewer.role.id}`, admin, "PUT", {
      ...reviewer.role,
      permissions: ["dashboard:view"],
    });
    await waitUntil(reviewStream.isClosed, 15000);
    await call("/operations/messages", reviewer.token, "GET", undefined, 403);
  } finally {
    streams.forEach((item) => item.close());
    const ids = (values) => {
      assert(values.every(Number.isSafeInteger));
      return values.length ? values.join(",") : "-1";
    };
    const requests = ids(made.requests),
      definitions = ids(made.definitions);
    sql(`START TRANSACTION;
      SELECT id FROM ops_event WHERE request_id IN (${requests}) FOR UPDATE;
      DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE n FROM ops_notification n WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE FROM ops_event WHERE request_id IN (${requests});
      DELETE FROM ops_flow_task WHERE request_id IN (${requests});
      DELETE FROM ops_flow_decision WHERE request_id IN (${requests});
      DELETE FROM ops_request_step WHERE request_id IN (${requests});
      DELETE FROM ops_request_file WHERE request_id IN (${requests});
      DELETE FROM ops_flow_request WHERE id IN (${requests});
      DELETE FROM ops_flow_step WHERE definition_id IN (${definitions});
      DELETE FROM ops_flow_version WHERE definition_id IN (${definitions});
      DELETE FROM ops_flow_definition WHERE id IN (${definitions}); COMMIT;`);
    for (const id of made.users)
      await call(`/system/users/${id}`, admin, "DELETE");
    for (const id of made.roles)
      await call(`/system/roles/${id}`, admin, "DELETE");
    await call("/auth/logout", admin, "POST");
  }
});
