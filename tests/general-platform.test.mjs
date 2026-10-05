/**
 * 通用平台的真实 HTTP/MySQL 验收，仅允许随机命名的独立基线工程和两种隔离数据库。
 * 测试凭据不打印；清理只使用本次记录的精确主键，单例监控策略恢复原业务配置。
 */
import { isolatedSql as runIsolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loginWithCaptcha } from "./support/captcha.mjs";
import {
  assertSingletonFixtureVersion,
  captureSingletonFixture,
  restoreSingletonFixture,
} from "./support/restore-singleton-fixture.mjs";

const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = `qa_general_${randomBytes(4).toString("hex")}`;
const password = "General_Qa2026!";
const contact = `${prefix}@example.com`;

/** 只返回成功数据，失败断言仅展示固定状态及业务消息，不把认证头或提交正文写入报告。 */
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

/** SQL 仅供没有业务删除入口的测试历史清理，不接受用户输入、日常项目或任意数据库名称。 */
function isolatedSql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  runIsolatedSql(statement);
}

/** 清理条件只包含服务端返回的正整数主键，空集合使用无匹配哨兵，不能退化为全表删除。 */
function ids(values) {
  assert(values.every((value) => Number.isSafeInteger(value) && value > 0));
  return values.length ? values.join(",") : "-1";
}

test("客户反馈、监控、调度与脱敏变更审计", { skip: !isolated }, async (t) => {
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  const made = { users: [], roles: [], feedback: [], jobs: [] };
  const secrets = [admin, password, contact];
  let originalPolicy;
  let originalPolicyFixture;
  let ownedPolicyVersion;

  async function role(label, permissions) {
    const result = await api("/system/roles", admin, "POST", {
      code: `${prefix}_${label}`,
      name: `${prefix}_${label}`,
      enabled: true,
      permissions,
      dataScopes: {},
      scopeDepartments: [],
    });
    made.roles.push(result.id);
    return result;
  }

  async function user(label, roleIds) {
    const result = await api("/system/users", admin, "POST", {
      username: `${prefix}_${label}`,
      nickname: label,
      email: contact,
      password,
      enabled: true,
      roleIds,
      postIds: [],
    });
    made.users.push(result.id);
    return result;
  }

  async function account(label, permissions) {
    const accountRole = await role(label, permissions);
    const accountUser = await user(label, [accountRole.id]);
    const token = (await loginWithCaptcha(base, accountUser.username, password))
      .token;
    secrets.push(token);
    return { role: accountRole, user: accountUser, token };
  }

  /** 同一部署中旧记录可能很多；有界分页只寻找本次精确主键，不按标题模糊删除历史。 */
  async function auditRecords(resource, resourceId) {
    const found = [];
    for (let page = 1; page <= 10; page++) {
      const result = await api(
        `/system/changes?keyword=${encodeURIComponent(resource)}&page=${page}&size=100`,
        admin,
      );
      found.push(
        ...result.items.filter(
          (record) =>
            record.resource === resource && record.resourceId === resourceId,
        ),
      );
      if (page * result.size >= result.total) break;
    }
    return found;
  }

  try {
    const viewer = await account("viewer", [
      "feedback:view",
      "monitor:view",
      "scheduler:view",
    ]);
    const processor = await account("processor", [
      "feedback:view",
      "feedback:process",
    ]);
    const manager = await account("manager", [
      "feedback:view",
      "feedback:process",
      "feedback:assign",
      "monitor:view",
      "monitor:configure",
      "scheduler:view",
      "scheduler:create",
      "scheduler:update",
    ]);
    const executor = await account("executor", [
      "scheduler:view",
      "scheduler:execute",
    ]);

    await t.test(
      "匿名反馈凭高熵码追踪，内部备注与分配身份不进入客户响应",
      async () => {
        await api("/operations/feedback", undefined, "GET", undefined, 401);
        const receipt = await api("/public/feedback", undefined, "POST", {
          type: "QUESTION",
          title: prefix,
          content: "页面操作问题",
          contact,
        });
        assert.match(receipt.receipt, /^[a-f0-9]{48}$/);
        secrets.push(receipt.receipt);
        const result = await api(
          `/operations/feedback?keyword=${prefix}`,
          admin,
        );
        assert.equal(result.items.length, 1);
        let feedback = await api(
          `/operations/feedback/${result.items[0].id}`,
          admin,
        );
        made.feedback.push(feedback.id);
        for (const response of [result, feedback]) {
          assert.equal(
            JSON.stringify(response).includes(receipt.receipt),
            false,
          );
          assert.equal("receiptHash" in feedback, false);
          assert.equal("receipt" in feedback, false);
        }
        await api(
          `/operations/feedback/${feedback.id}/process`,
          viewer.token,
          "POST",
          {
            version: feedback.version,
            status: "PROCESSING",
          },
          403,
        );
        await api(
          `/operations/feedback/${feedback.id}/process`,
          processor.token,
          "POST",
          {
            version: feedback.version,
            status: "PROCESSING",
            assigneeId: processor.user.id,
          },
          403,
        );
        await api(
          "/operations/feedback/assignees",
          processor.token,
          "GET",
          undefined,
          403,
        );
        await api(
          `/operations/feedback/${feedback.id}/process`,
          processor.token,
          "POST",
          {
            version: feedback.version,
            status: "RESOLVED",
            internalNote: "不可替代公开回复",
          },
          400,
        );
        const privateNote = `${prefix}_private_note`;
        feedback = await api(
          `/operations/feedback/${feedback.id}/process`,
          processor.token,
          "POST",
          {
            version: feedback.version,
            status: "PROCESSING",
            internalNote: privateNote,
          },
        );
        let publicView = await api(
          "/public/feedback/track",
          undefined,
          "POST",
          { receipt: receipt.receipt },
        );
        assert.equal(publicView.status, "PROCESSING");
        assert.equal(JSON.stringify(publicView).includes(privateNote), false);
        assert.equal(JSON.stringify(publicView).includes(contact), false);
        assert.equal("assigneeId" in publicView, false);
        assert(
          publicView.history.every(
            (item) => !("actor" in item) && !("internalNote" in item),
          ),
        );
        const beforeAssignment = feedback.version;
        feedback = await api(
          `/operations/feedback/${feedback.id}/process`,
          manager.token,
          "POST",
          {
            version: feedback.version,
            status: "PROCESSING",
            assigneeId: processor.user.id,
          },
        );
        assert.equal(feedback.assigneeId, processor.user.id);
        await api(
          `/operations/feedback/${feedback.id}/process`,
          manager.token,
          "POST",
          {
            version: beforeAssignment,
            status: "CLOSED",
            assigneeId: processor.user.id,
          },
          409,
        );
        const publicReply = "问题已修复，请刷新页面后重试。";
        feedback = await api(
          `/operations/feedback/${feedback.id}/process`,
          processor.token,
          "POST",
          {
            version: feedback.version,
            status: "RESOLVED",
            assigneeId: processor.user.id,
            publicReply,
            internalNote: privateNote,
          },
        );
        assert(
          feedback.history.some((item) => item.internalNote === privateNote),
        );
        publicView = await api("/public/feedback/track", undefined, "POST", {
          receipt: receipt.receipt,
        });
        assert.equal(publicView.status, "RESOLVED");
        assert(publicView.history.some((item) => item.reply === publicReply));
        assert.equal(JSON.stringify(publicView).includes(privateNote), false);
        await api(
          "/public/feedback/track",
          undefined,
          "POST",
          { receipt: "f".repeat(48) },
          400,
        );
      },
    );

    await t.test(
      "监控查看和配置分权，历史窗口与旧版本均由服务端限制",
      async () => {
        await api(
          "/operations/monitor",
          processor.token,
          "GET",
          undefined,
          403,
        );
        const snapshot = await api("/operations/monitor", viewer.token);
        assert.equal(snapshot.database, true);
        assert(snapshot.heapUsed >= 0 && snapshot.threads > 0);
        // API 不暴露 last_alert_at，原始基线必须来自隔离库完整行，不能只备份响应投影。
        originalPolicyFixture = captureSingletonFixture("ops_monitor_policy");
        originalPolicy = await api("/operations/monitor/policy", admin);
        assertSingletonFixtureVersion(
          originalPolicyFixture,
          originalPolicy.version,
        );
        ownedPolicyVersion = originalPolicy.version;
        assert.equal("lastAlertAt" in originalPolicy, false);
        const edit = {
          ...originalPolicy,
          enabled: false,
          heapThresholdPercent: 80,
          databaseThresholdMs: 1234,
          alertUserId: manager.user.id,
        };
        await api("/operations/monitor/policy", viewer.token, "PUT", edit, 403);
        await api(
          "/operations/monitor/recipients",
          viewer.token,
          "GET",
          undefined,
          403,
        );
        await api(
          "/operations/monitor/policy",
          manager.token,
          "PUT",
          { ...edit, heapThresholdPercent: 40 },
          400,
        );
        await api(
          "/operations/monitor/policy",
          manager.token,
          "PUT",
          { ...edit, alertUserId: processor.user.id },
          400,
        );
        const saved = await api(
          "/operations/monitor/policy",
          manager.token,
          "PUT",
          edit,
        );
        ownedPolicyVersion = saved.version;
        assert.equal(saved.databaseThresholdMs, 1234);
        assert(saved.version > originalPolicy.version);
        await api(
          "/operations/monitor/policy",
          manager.token,
          "PUT",
          edit,
          409,
        );
        await api(
          "/operations/monitor/history?minutes=4",
          viewer.token,
          "GET",
          undefined,
          400,
        );
        await api(
          "/operations/monitor/history?minutes=61",
          viewer.token,
          "GET",
          undefined,
          400,
        );
        for (const minutes of [5, 60]) {
          const history = await api(
            `/operations/monitor/history?minutes=${minutes}`,
            viewer.token,
          );
          assert(Array.isArray(history) && history.length <= 120);
          assert(
            history.every(
              (sample, index) =>
                index === 0 || sample.id > history[index - 1].id,
            ),
          );
        }
      },
    );

    await t.test(
      "调度仅允许已注册处理器，手动执行独立授权且数据库检查真实成功",
      async () => {
        const handlers = await api(
          "/operations/scheduler/handlers",
          viewer.token,
        );
        assert.equal(typeof handlers.DATABASE_CHECK, "string");
        assert.equal(typeof handlers.SESSION_CLEANUP, "string");
        assert(
          Object.keys(handlers).every((key) =>
            /^[A-Z][A-Z0-9_]{0,63}$/.test(key),
          ),
        );
        const draft = {
          name: prefix,
          handler: "DATABASE_CHECK",
          cron: "0 */5 * * * *",
          enabled: false,
          alertUserId: manager.user.id,
        };
        await api("/operations/scheduler", viewer.token, "POST", draft, 403);
        await api(
          "/operations/scheduler",
          manager.token,
          "POST",
          { ...draft, handler: "java.lang.Runtime" },
          400,
        );
        await api(
          "/operations/scheduler",
          manager.token,
          "POST",
          { ...draft, cron: "* *" },
          400,
        );
        let job = await api(
          "/operations/scheduler",
          manager.token,
          "POST",
          draft,
        );
        made.jobs.push(job.id);
        await api(
          `/operations/scheduler/${job.id}/run`,
          manager.token,
          "POST",
          undefined,
          403,
        );
        const execution = await api(
          `/operations/scheduler/${job.id}/run`,
          executor.token,
          "POST",
        );
        assert.equal(execution.status, "SUCCESS");
        assert.equal(execution.jobId, job.id);
        assert.equal(execution.result, "数据库连接正常");
        const logs = await api(
          `/operations/job-logs?jobId=${job.id}`,
          viewer.token,
        );
        assert.equal(logs.total, 1);
        assert.equal(logs.items[0].id, execution.id);
        const previousVersion = job.version;
        job = await api(
          `/operations/scheduler/${job.id}`,
          manager.token,
          "PUT",
          { ...draft, name: `${prefix}_edited`, version: previousVersion },
        );
        await api(
          `/operations/scheduler/${job.id}`,
          manager.token,
          "PUT",
          { ...draft, version: previousVersion },
          409,
        );
        assert(job.version > previousVersion);
      },
    );

    await t.test(
      "账号与角色变更保存前后值，联系方式密码和所有凭据均不进入审计",
      async () => {
        await api("/system/changes", viewer.token, "GET", undefined, 403);
        let auditRole = await role("audit", ["dashboard:view"]);
        const originalName = auditRole.name;
        const subject = await user("subject", [auditRole.id]);
        await api(`/system/users/${subject.id}`, admin, "PUT", {
          ...subject,
          enabled: false,
          roleIds: [auditRole.id],
          postIds: [],
          email: contact,
        });
        auditRole = await api(`/system/roles/${auditRole.id}`, admin, "PUT", {
          ...auditRole,
          name: `${originalName}_edited`,
          permissions: ["dashboard:view", "feedback:view"],
        });
        const accountChanges = await auditRecords("用户", subject.id);
        const roleChanges = await auditRecords("角色", auditRole.id);
        assert(
          accountChanges.some(
            (record) =>
              record.action === "创建账号" &&
              record.changes.some(
                (change) =>
                  change.field === "账号" &&
                  change.before === "—" &&
                  change.after === subject.username,
              ),
          ),
        );
        assert(
          accountChanges.some((record) =>
            record.changes.some(
              (change) =>
                change.field === "启用" &&
                change.before === "true" &&
                change.after === "false",
            ),
          ),
        );
        assert(roleChanges.some((record) => record.action === "创建角色"));
        assert(
          roleChanges.some((record) =>
            record.changes.some(
              (change) =>
                change.field === "角色名称" &&
                change.before === originalName &&
                change.after === auditRole.name,
            ),
          ),
        );
        for (const record of [...accountChanges, ...roleChanges]) {
          const detail = await api(`/system/changes/${record.id}`, admin);
          assert.deepEqual(detail.changes, record.changes);
          const serialized = JSON.stringify(detail);
          for (const secret of secrets)
            assert.equal(
              serialized.includes(secret),
              false,
              "审计不能包含凭据或联系方式",
            );
          assert(
            detail.changes.every(
              (change) =>
                !/(password|secret|token|email|phone|正文|密码|令牌|邮箱|电话)/i.test(
                  change.field,
                ),
            ),
          );
        }
      },
    );
  } finally {
    if (originalPolicy) {
      const current = await api("/operations/monitor/policy", admin);
      // 使用本测试拥有的版本，其他操作或监控告警更新均须导致失败，不能被清理覆盖。
      assert.equal(
        current.version,
        ownedPolicyVersion,
        "监控单例策略在测试期间被其他操作修改，拒绝覆盖",
      );
      const restored = await api("/operations/monitor/policy", admin, "PUT", {
        ...originalPolicy,
        version: ownedPolicyVersion,
      });
      restoreSingletonFixture(originalPolicyFixture, {
        version: restored.version,
      });
    }
    const feedbackIds = ids(made.feedback),
      jobIds = ids(made.jobs);
    isolatedSql(`START TRANSACTION;
      DELETE delivery FROM ops_delivery delivery JOIN ops_notification notification ON notification.id=delivery.notification_id WHERE notification.target_type='FEEDBACK' AND notification.target_id IN (${feedbackIds});
      DELETE target FROM ops_notification_target target JOIN ops_notification notification ON notification.id=target.notification_id WHERE notification.target_type='FEEDBACK' AND notification.target_id IN (${feedbackIds});
      DELETE FROM ops_notification WHERE target_type='FEEDBACK' AND target_id IN (${feedbackIds});
      DELETE FROM ops_feedback_history WHERE feedback_id IN (${feedbackIds});
      DELETE FROM ops_feedback WHERE id IN (${feedbackIds});
      DELETE FROM ops_job_execution WHERE job_id IN (${jobIds});
      COMMIT;`);
    for (const id of made.jobs.reverse()) {
      // 持久任务队列没有依赖配置表的级联删除；只清理由本轮执行记录生成的业务键。
      isolatedSql(
        `DELETE FROM sys_durable_task WHERE task_type='SCHEDULER' AND business_key LIKE '${id}:%';`,
      );
      await api(`/operations/scheduler/${id}`, admin, "DELETE");
    }
    for (const id of made.users.reverse())
      await api(`/system/users/${id}`, admin, "DELETE");
    for (const id of made.roles.reverse())
      await api(`/system/roles/${id}`, admin, "DELETE");
    isolatedSql(
      `DELETE FROM sys_change_audit WHERE (resource='用户' AND resource_id IN (${ids(made.users)})) OR (resource='角色' AND resource_id IN (${ids(made.roles)}));`,
    );
    await api("/auth/logout", admin, "POST");
  }
});
