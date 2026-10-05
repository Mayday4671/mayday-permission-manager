/**
 * 审批字段授权的真实 HTTP 回归。仅使用随机 native 验收项目；不向日常接口写入数据。
 * 既有参与权与当前节点字段权分开核验：曾办理前置节点不能提前读取顺签候选节点。
 * 申请历史不可通过生产接口删除，因此 finally 只按本次登记 ID 清理隔离库，再走文件回收接口。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { isolatedSql } from "./support/isolated-compose.mjs";
import { purgeTestFiles } from "./support/files-cleanup.mjs";

const base = process.env.API_BASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(
    process.env.API_TEST_COMPOSE_PROJECT ?? "",
  ) && ["upgrade-db", "fresh-db"].includes(process.env.API_TEST_DATABASE);
const prefix = `qa_fields_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
const password = "FieldActivationQa_2026!";
const made = {
  users: [],
  roles: [],
  definitions: [],
  requests: [],
  files: [],
  delegations: [],
};

/** 不把请求正文或业务字段写入断言错误，失败只报告固定接口与 HTTP 状态。 */
async function call(path, token, method = "GET", body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, status, `${method} ${path} HTTP 状态不符`);
  const envelope = await response.json();
  if (status === 200) assert.equal(envelope.success, true);
  return envelope.data;
}

/** 当前、提交快照、变更历史及文件目录必须采用相同字段授权，不能只隐藏表单控件。 */
function expectHidden(view) {
  for (const key of ["secret", "proof"]) {
    assert(
      !view.fields.some((field) => field.id === key),
      "尚未激活的节点不能返回敏感字段定义",
    );
    assert.equal(
      view.values[key],
      undefined,
      "尚未激活的节点不能返回敏感字段值",
    );
    for (const history of view.history) {
      assert.equal(
        history.submittedValues[key],
        undefined,
        "提交历史不能绕过字段授权",
      );
      assert.equal(history.changes[key], undefined, "变更历史不能绕过字段授权");
    }
  }
  assert.equal(view.files.length, 0, "未获附件字段权不能读取文件目录");
  assert.equal(
    view.values.memo,
    "前置节点可读说明",
    "前置参与人的原字段权仍应有效",
  );
}

/** 清理仅接受本次程序登记的正整数，空集合不能退化为无条件删除。 */
function ids(values) {
  assert(values.every((value) => Number.isSafeInteger(value) && value > 0));
  return values.length ? values.join(",") : "-1";
}

test("字段权限只由实际激活任务授予", { skip: !isolated }, async (t) => {
  const address = new URL(base);
  assert.equal(address.protocol, "http:");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname));
  assert.equal(address.pathname, "/api");
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  let department;
  let category;
  try {
    department = await call("/system/entries/departments", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    category = await call("/system/entries/approvalcategories", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    const account = async (label, approver, delegationOwner = false) => {
      const role = await call("/system/roles", admin, "POST", {
        name: prefix + label,
        code: prefix + label,
        enabled: true,
        permissions: approver
          ? [
              "requests:view",
              "requests:approve",
              "messages:view",
              ...(delegationOwner ? ["requests:delegate", "users:view"] : []),
            ]
          : [
              "requests:view",
              "requests:create",
              "messages:view",
              "files:view",
              "files:create",
            ],
        dataScopes: delegationOwner ? { users: "ALL" } : {},
      });
      made.roles.push(role.id);
      const user = await call("/system/users", admin, "POST", {
        username: prefix + label,
        nickname: label,
        password,
        enabled: true,
        departmentId: department.id,
        roleIds: [role.id],
      });
      made.users.push(user.id);
      return {
        ...user,
        token: (await loginWithCaptcha(base, user.username, password)).token,
      };
    };
    const applicant = await account("app", false);
    const a = await account("a", true);
    const b = await account("b", true);
    const c = await account("c", true, true);
    const d = await account("d", true);

    const approval = (id, people, next, extra = {}) => ({
      id,
      name: id,
      type: "APPROVAL",
      source: "USERS",
      assigneeIds: people.map((person) => person.id),
      mode: "ALL",
      next,
      readable: ["memo"],
      writable: [],
      actions: ["APPROVE", "REJECT", "RETURN", "COMMENT"],
      ...extra,
    });
    const model = (parallel) => {
      const serial = approval("serial", [a, b], parallel ? "join" : "end", {
        mode: "SERIAL",
        readable: ["memo", "secret", "proof"],
        writable: ["secret"],
      });
      return {
        fields: [
          {
            id: "memo",
            label: "说明",
            type: "TEXT",
            width: 24,
            required: true,
          },
          { id: "secret", label: "受保护字段", type: "TEXT", width: 24 },
          { id: "proof", label: "受保护附件", type: "FILES", width: 24 },
        ],
        nodes: [
          approval("pre", [b], parallel ? "fork" : "serial"),
          ...(parallel
            ? [
                {
                  id: "fork",
                  name: "并行组",
                  type: "PARALLEL",
                  branches: ["serial", "other"],
                  next: "join",
                },
                serial,
                approval("other", [c], "join"),
                { id: "join", name: "汇合", type: "JOIN", next: "end" },
              ]
            : [serial]),
          { id: "end", name: "结束", type: "END" },
        ],
        startNodeId: "pre",
        applicantType: "ALL",
        applicantIds: [],
        allowSelfApproval: false,
        allowRepeatApproval: true,
        allowWithdraw: true,
      };
    };
    const publish = async (parallel) => {
      const draft = await call("/operations/workflows", admin, "POST", {
        name: prefix + made.definitions.length,
        code: prefix + "_" + made.definitions.length,
        categoryId: category.id,
        businessType: "GENERAL",
        enabled: true,
        schema: model(parallel),
      });
      made.definitions.push(draft.id);
      return call(`/operations/workflows/${draft.id}/publish`, admin, "POST", {
        version: draft.version,
      });
    };
    const upload = async () => {
      const body = new FormData();
      body.set(
        "file",
        new Blob(["隔离字段授权附件"], { type: "text/plain" }),
        "proof.txt",
      );
      const response = await fetch(base + "/operations/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${applicant.token}` },
        body,
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200);
      const file = (await response.json()).data;
      made.files.push(file.id);
      return file;
    };
    const detail = (id, token) => call(`/operations/requests/${id}`, token);
    const decide = async (id, person, action = "APPROVE", extra = {}) => {
      const current = await detail(id, person.token);
      assert(current.myTaskId, "办理人必须有当前真实待办");
      return call(`/operations/requests/${id}/decision`, person.token, "POST", {
        version: current.version,
        taskId: current.myTaskId,
        action,
        comment: "字段激活回归",
        ...extra,
      });
    };
    const submit = async (definition, file) => {
      const request = await call(
        "/operations/requests",
        applicant.token,
        "POST",
        {
          definitionId: definition.id,
          versionId: definition.publishedVersionId,
          title: prefix + " 申请",
          values: {
            memo: "前置节点可读说明",
            secret: "初始受保护值",
            proof: [file.id],
          },
        },
      );
      made.requests.push(request.id);
      return request;
    };
    const download = async (id, file, person, status) => {
      const response = await fetch(
        base + `/operations/requests/${id}/files/${file.id}`,
        {
          headers: { Authorization: `Bearer ${person.token}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      assert.equal(response.status, status, "附件下载必须采用实际激活字段权");
      await response.arrayBuffer();
    };

    for (const parallel of [false, true])
      await t.test(
        parallel
          ? "并行游标中的顺签等待者不提前获得字段权"
          : "单线顺签等待者已有参与权也不能提前读取",
        async () => {
          const definition = await publish(parallel);
          const file = await upload();
          const request = await submit(definition, file);
          await decide(request.id, b);
          const waiting = await detail(request.id, b.token);
          assert(
            waiting.tasks.some(
              (task) =>
                task.nodeId === "serial" &&
                task.assigneeId === b.id &&
                task.status === "WAITING",
            ),
          );
          assert.equal(waiting.myTaskId, null);
          expectHidden(waiting);
          await download(request.id, file, b, 403);
          await decide(request.id, a, "APPROVE", {
            values: { secret: "激活前已核对值" },
          });
          const active = await detail(request.id, b.token);
          assert(active.myTaskId, "前人完成后等待者才获得待办");
          assert.equal(active.values.secret, "激活前已核对值");
          assert.deepEqual(active.values.proof, [file.id]);
          assert(active.files.some((item) => item.id === file.id));
          assert(
            active.history.some(
              (history) =>
                history.changes.secret?.before === "初始受保护值" &&
                history.changes.secret?.after === "激活前已核对值",
            ),
          );
          await download(request.id, file, b, 200);
          await decide(request.id, b);
          if (parallel) await decide(request.id, c);
          assert.equal(
            (await detail(request.id, applicant.token)).status,
            "APPROVED",
          );
        },
      );

    await t.test(
      "取消未激活顺签后退回重提，不从旧 CANCELLED 任务获取字段权",
      async () => {
        const definition = await publish(false);
        const file = await upload();
        const request = await submit(definition, file);
        await decide(request.id, b);
        await decide(request.id, a, "RETURN");
        const returned = await detail(request.id, b.token);
        assert.equal(returned.status, "RETURNED");
        assert(
          returned.tasks.some(
            (task) =>
              task.nodeId === "serial" &&
              task.assigneeId === b.id &&
              task.status === "CANCELLED",
          ),
        );
        expectHidden(returned);
        await download(request.id, file, b, 403);
        const current = await detail(request.id, applicant.token);
        await call(
          `/operations/requests/${request.id}/submit`,
          applicant.token,
          "POST",
          {
            version: current.version,
            title: current.title,
            values: {
              memo: "前置节点可读说明",
              secret: "重提受保护值",
              proof: [file.id],
            },
          },
        );
        const restarted = await detail(request.id, b.token);
        assert.equal(restarted.runNumber, 2);
        assert(restarted.myTaskId, "重提后前置节点仍由 B 正常办理");
        expectHidden(restarted);
        await download(request.id, file, b, 403);
        await decide(request.id, b);
        expectHidden(await detail(request.id, b.token));
        await decide(request.id, a);
        const active = await detail(request.id, b.token);
        assert.equal(active.values.secret, "重提受保护值");
        await download(request.id, file, b, 200);
        await decide(request.id, b);
      },
    );

    await t.test(
      "已激活后取消保留本轮历史，重提新轮敏感值仍等待重新激活",
      async () => {
        const definition = await publish(true);
        const previousFile = await upload();
        const nextFile = await upload();
        const request = await submit(definition, previousFile);
        await decide(request.id, b);
        await decide(request.id, a, "APPROVE", {
          values: { secret: "首轮已核对值" },
        });
        const firstActive = await detail(request.id, b.token);
        assert.equal(firstActive.values.secret, "首轮已核对值");
        await decide(request.id, c, "RETURN");
        const cancelled = await detail(request.id, b.token);
        assert.equal(cancelled.status, "RETURNED");
        assert(
          cancelled.tasks.some(
            (task) =>
              task.nodeId === "serial" &&
              task.assigneeId === b.id &&
              task.status === "CANCELLED",
          ),
        );
        assert.equal(
          cancelled.values.secret,
          "首轮已核对值",
          "已实际激活的取消任务仍保留该轮合法字段权",
        );
        await download(request.id, previousFile, b, 200);
        const current = await detail(request.id, applicant.token);
        await call(
          `/operations/requests/${request.id}/submit`,
          applicant.token,
          "POST",
          {
            version: current.version,
            title: current.title,
            values: {
              memo: "前置节点可读说明",
              secret: "二轮新增受保护值",
              proof: [nextFile.id],
            },
          },
        );
        const restarted = await detail(request.id, b.token);
        assert.equal(restarted.runNumber, 2);
        assert.equal(
          restarted.values.secret,
          undefined,
          "上一轮已激活不能提前读取新轮当前字段值",
        );
        assert.equal(restarted.values.proof, undefined);
        assert(!restarted.fields.some((field) => field.id === "secret"));
        assert(!restarted.files.some((file) => file.id === nextFile.id));
        const previousHistory = restarted.history.filter(
          (history) => history.runNumber === 1,
        );
        assert(
          previousHistory.some(
            (history) => history.changes.secret?.after === "首轮已核对值",
          ),
          "前轮合法激活的历史仍可核对",
        );
        for (const history of restarted.history.filter(
          (item) => item.runNumber === 2,
        )) {
          assert.equal(history.submittedValues.secret, undefined);
          assert.equal(history.submittedValues.proof, undefined);
          assert.equal(history.changes.secret, undefined);
          assert.equal(history.changes.proof, undefined);
        }
        await download(request.id, previousFile, b, 200);
        await download(request.id, nextFile, b, 403);
        await decide(request.id, b);
        assert.equal(
          (await detail(request.id, b.token)).values.secret,
          undefined,
        );
        await decide(request.id, a);
        const active = await detail(request.id, b.token);
        assert.equal(active.values.secret, "二轮新增受保护值");
        await download(request.id, nextFile, b, 200);
        await decide(request.id, b);
        await decide(request.id, c);
      },
    );

    await t.test(
      "交接尚未激活的顺签任务，不因保留原指定人而向旧人授予字段权",
      async () => {
        const definition = await publish(false);
        const file = await upload();
        const request = await submit(definition, file);
        await decide(request.id, b);
        const current = await detail(request.id, admin);
        await call(
          `/operations/requests/${request.id}/handover`,
          admin,
          "POST",
          {
            version: current.version,
            fromUserId: b.id,
            targetUserId: c.id,
            reason: "未轮到的任务交接验收",
          },
        );
        expectHidden(await detail(request.id, b.token));
        await decide(request.id, a);
        const source = await detail(request.id, b.token);
        assert(
          source.tasks.some(
            (task) =>
              task.nodeId === "serial" &&
              task.assigneeId === c.id &&
              task.originalAssigneeId === b.id &&
              task.status === "PENDING",
          ),
          "交接审计保留原指定账号，但不构成原账号字段授权",
        );
        expectHidden(source);
        await download(request.id, file, b, 403);
        const receiver = await detail(request.id, c.token);
        assert(receiver.myTaskId);
        assert.equal(receiver.values.secret, "初始受保护值");
        await download(request.id, file, c, 200);
        await decide(request.id, c);
        expectHidden(await detail(request.id, b.token));
      },
    );

    await t.test(
      "排队交接后的实际委托人继承字段权，旧指定人不能冒充委托人",
      async () => {
        const definition = await publish(false);
        const file = await upload();
        const request = await submit(definition, file);
        await decide(request.id, b);
        const current = await detail(request.id, admin);
        await call(
          `/operations/requests/${request.id}/handover`,
          admin,
          "POST",
          {
            version: current.version,
            fromUserId: b.id,
            targetUserId: c.id,
            reason: "排队交接与委托身份边界验收",
          },
        );
        const localTime = (minutes) =>
          new Date(Date.now() + minutes * 60000)
            .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
            .replace(" ", "T");
        const delegation = await call(
          "/operations/delegations",
          c.token,
          "POST",
          {
            targetId: d.id,
            startsAt: localTime(0),
            endsAt: localTime(120),
            definitionIds: [definition.id],
            reason: "只委托本次隔离流程",
          },
        );
        made.delegations.push(delegation.id);
        await decide(request.id, a);
        const former = await detail(request.id, b.token);
        assert(
          former.tasks.some(
            (task) =>
              task.nodeId === "serial" &&
              task.assigneeId === d.id &&
              task.delegationId === delegation.id &&
              task.status === "PENDING",
          ),
          "真实接收人应承办已激活的委托任务",
        );
        expectHidden(former);
        await download(request.id, file, b, 403);
        const owner = await detail(request.id, c.token);
        assert.equal(
          owner.myTaskId,
          null,
          "委托人保留阅读权但不代替接收人办理",
        );
        assert.equal(owner.values.secret, "初始受保护值");
        await download(request.id, file, c, 200);
        const receiver = await detail(request.id, d.token);
        assert(receiver.myTaskId);
        assert.equal(receiver.values.secret, "初始受保护值");
        await download(request.id, file, d, 200);
        await decide(request.id, d);
        expectHidden(await detail(request.id, b.token));
        const latestDelegation = await call("/operations/delegations", c.token);
        const toRevoke = latestDelegation.items.find(
          (item) => item.id === delegation.id,
        );
        assert(toRevoke);
        await call(
          `/operations/delegations/${delegation.id}/revoke`,
          c.token,
          "POST",
          {
            version: toRevoke.version,
          },
        );
      },
    );

    for (const closeAction of ["RETURN", "WITHDRAW"])
      await t.test(
        `${closeAction} 后先保存的修改不会向其他参与者公开，失败重提保留私人稿`,
        async () => {
          const definition = await publish(true);
          const previousFile = await upload();
          const nextFile = await upload();
          const request = await submit(definition, previousFile);
          await decide(request.id, b);
          await decide(request.id, a);
          if (closeAction === "RETURN") await decide(request.id, c, "RETURN");
          else {
            const pending = await detail(request.id, applicant.token);
            await call(
              `/operations/requests/${request.id}/decision`,
              applicant.token,
              "POST",
              {
                version: pending.version,
                action: "WITHDRAW",
                comment: "隔离回归撤回修改",
              },
            );
          }
          const changedValues = {
            memo: "前置节点可读说明",
            secret: "退回后尚未提交的私有新值",
            proof: [nextFile.id],
          };
          const privateTitle = prefix + " 尚未提交的私有标题";
          const returned = await detail(request.id, applicant.token);
          await call(
            `/operations/requests/${request.id}`,
            applicant.token,
            "PUT",
            {
              version: returned.version,
              title: privateTitle,
              values: { ...changedValues, secret: "首次保存私有值" },
            },
          );
          const firstSave = await detail(request.id, applicant.token);
          await call(
            `/operations/requests/${request.id}`,
            applicant.token,
            "PUT",
            {
              version: firstSave.version,
              title: privateTitle,
              values: changedValues,
            },
          );
          let saved = await detail(request.id, applicant.token);
          assert.equal(
            saved.values.secret,
            changedValues.secret,
            "申请人仍可继续自己的修改草稿",
          );
          assert.equal(saved.title, privateTitle);
          const encodedTitle = encodeURIComponent(privateTitle);
          for (const [token, box] of [
            [b.token, "participated"],
            [admin, "all"],
          ]) {
            const rows = await call(
              `/operations/requests?box=${box}&keyword=${encodedTitle}`,
              token,
            );
            assert(
              !rows.items.some((row) => row.id === request.id),
              "私人稿标题不能通过列表或搜索透露",
            );
          }
          const ownRows = await call(
            `/operations/requests?box=mine&keyword=${encodedTitle}`,
            applicant.token,
          );
          assert(
            ownRows.items.some(
              (row) => row.id === request.id && row.title === privateTitle,
            ),
            "申请人列表仍可找到自己的私人稿",
          );
          // 故意提交过期版本，必须保留自己的私人稿，不能在失败响应前清空。
          await call(
            `/operations/requests/${request.id}/submit`,
            applicant.token,
            "POST",
            {
              version: firstSave.version,
              title: privateTitle,
              values: changedValues,
            },
            409,
          );
          saved = await detail(request.id, applicant.token);
          assert.equal(saved.values.secret, changedValues.secret);
          assert.equal(saved.title, privateTitle);
          const beforeSubmit = await detail(request.id, b.token);
          assert.notEqual(beforeSubmit.values.secret, changedValues.secret);
          assert.notEqual(beforeSubmit.values.secret, "首次保存私有值");
          assert.notEqual(beforeSubmit.title, privateTitle);
          assert(!beforeSubmit.values.proof?.includes(nextFile.id));
          assert(!beforeSubmit.files.some((file) => file.id === nextFile.id));
          for (const item of beforeSubmit.history) {
            assert.notEqual(item.submittedValues.secret, changedValues.secret);
            assert.notEqual(item.changes.secret?.after, changedValues.secret);
            assert(!item.submittedValues.proof?.includes(nextFile.id));
            assert(!item.changes.proof?.after?.includes(nextFile.id));
            assert(!item.files.some((file) => file.id === nextFile.id));
          }
          await download(request.id, previousFile, b, 200);
          await download(request.id, nextFile, b, 403);
          const administrator = await detail(request.id, admin);
          assert.notEqual(
            administrator.title,
            privateTitle,
            "管理权限也不提前公开申请人的私人稿标题",
          );
          assert.notEqual(administrator.values.secret, changedValues.secret);
          assert.notEqual(administrator.values.secret, "首次保存私有值");
          assert(!administrator.values.proof?.includes(nextFile.id));
          assert(!administrator.files.some((file) => file.id === nextFile.id));
          for (const item of administrator.history) {
            assert.notEqual(item.changes.secret?.after, changedValues.secret);
            assert.notEqual(item.changes.secret?.after, "首次保存私有值");
            assert(!item.files.some((file) => file.id === nextFile.id));
          }
          const newFileAsAdministrator = await fetch(
            base + `/operations/requests/${request.id}/files/${nextFile.id}`,
            {
              headers: { Authorization: `Bearer ${admin}` },
              signal: AbortSignal.timeout(30000),
            },
          );
          assert.equal(newFileAsAdministrator.status, 403);
          await newFileAsAdministrator.arrayBuffer();
          await call(
            `/operations/requests/${request.id}/submit`,
            applicant.token,
            "POST",
            {
              version: saved.version,
              title: saved.title,
              values: changedValues,
            },
          );
          const resubmitted = await detail(request.id, b.token);
          assert.equal(resubmitted.runNumber, 2);
          assert.equal(resubmitted.values.secret, undefined);
          assert.equal(resubmitted.values.proof, undefined);
          for (const item of resubmitted.history) {
            assert.notEqual(item.submittedValues.secret, changedValues.secret);
            assert.notEqual(item.changes.secret?.after, changedValues.secret);
            assert(!item.files.some((file) => file.id === nextFile.id));
          }
          await download(request.id, previousFile, b, 200);
          await download(request.id, nextFile, b, 403);
          await decide(request.id, b);
          await decide(request.id, a);
          const activated = await detail(request.id, b.token);
          assert.equal(activated.values.secret, changedValues.secret);
          assert.deepEqual(activated.values.proof, [nextFile.id]);
          await download(request.id, nextFile, b, 200);
          await decide(request.id, b);
          await decide(request.id, c);
        },
      );

    await t.test(
      "旧版 EDIT 已覆盖提交列时，重构已提交视图并保留申请人的修改",
      async () => {
        const definition = await publish(true);
        const previousFile = await upload();
        const nextFile = await upload();
        const request = await submit(definition, previousFile);
        await decide(request.id, b);
        await decide(request.id, a);
        await decide(request.id, c, "RETURN");
        const changedValues = {
          memo: "前置节点可读说明",
          secret: "旧版已保存但尚未重提的私有值",
          proof: [nextFile.id],
        };
        const privateTitle = prefix + " 旧版私人稿标题";
        const returned = await detail(request.id, applicant.token);
        await call(
          `/operations/requests/${request.id}`,
          applicant.token,
          "PUT",
          {
            version: returned.version,
            title: privateTitle,
            values: changedValues,
          },
        );
        // 只在已绑定本轮 native 私库中模拟旧布局。先确认库名、迁移列与本次申请归属；
        // 不修改 Flyway 历史，不改其他申请，不允许空 ID 或通配更新。
        const databaseName = new URL(
          process.env.DB_URL.replace(/^jdbc:/, ""),
        ).pathname.slice(1);
        assert(/^\w+$/.test(databaseName));
        assert.equal(
          isolatedSql("SELECT DATABASE();").trim(),
          databaseName,
          "旧布局模拟必须绑定当前隔离数据库",
        );
        assert.equal(
          isolatedSql(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ops_flow_request' AND column_name='private_draft';",
          ).trim(),
          "1",
          "本轮数据库须已包含私人稿迁移列",
        );
        assert.equal(
          isolatedSql(
            `SELECT COUNT(*) FROM ops_flow_request WHERE id=${request.id} AND applicant_id=${applicant.id} AND title LIKE '${prefix}%';`,
          ).trim(),
          "1",
          "旧布局模拟只接受本次登记申请",
        );
        const textLiteral = (value) => "'" + value.replace(/'/g, "''") + "'";
        const result = isolatedSql(
          `UPDATE ops_flow_request SET private_draft=NULL, form_data=${textLiteral(JSON.stringify(changedValues))}, title=${textLiteral(privateTitle)}, version=version+1 WHERE id=${request.id} AND applicant_id=${applicant.id}; SELECT ROW_COUNT();`,
        );
        assert.equal(result.trim(), "1", "旧布局模拟只能改变一条已登记申请");
        assert.equal(
          isolatedSql(
            `SELECT COUNT(*) FROM ops_flow_decision WHERE request_id=${request.id} AND run_number=1 AND action='EDIT';`,
          ).trim(),
          "1",
          "旧布局必须包含旧轮保存记录，不能只模拟一行表单值",
        );
        const own = await detail(request.id, applicant.token);
        assert.equal(
          own.values.secret,
          changedValues.secret,
          "旧版保存的申请人修改仍可继续编辑",
        );
        assert.deepEqual(own.values.proof, [nextFile.id]);
        for (const token of [b.token, admin]) {
          const visible = await detail(request.id, token);
          assert.equal(
            visible.values.secret,
            "初始受保护值",
            "历史提交快照恢复最后真正提交的值",
          );
          assert.deepEqual(visible.values.proof, [previousFile.id]);
          assert.notEqual(visible.title, privateTitle);
          const box = token === admin ? "all" : "participated";
          const rows = await call(
            `/operations/requests?box=${box}&keyword=${encodeURIComponent(privateTitle)}`,
            token,
          );
          assert(
            !rows.items.some((row) => row.id === request.id),
            "旧版私人标题不能在列表搜索泄露",
          );
          assert(!visible.files.some((file) => file.id === nextFile.id));
          for (const item of visible.history) {
            assert.notEqual(item.changes.secret?.after, changedValues.secret);
            assert(!item.files.some((file) => file.id === nextFile.id));
          }
          const response = await fetch(
            base + `/operations/requests/${request.id}/files/${nextFile.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(30000),
            },
          );
          assert.equal(response.status, 403);
          await response.arrayBuffer();
        }
        await download(request.id, previousFile, b, 200);
        await call(
          `/operations/requests/${request.id}/submit`,
          applicant.token,
          "POST",
          {
            version: own.version,
            title: own.title,
            values: changedValues,
          },
        );
        const restarted = await detail(request.id, b.token);
        assert.equal(restarted.runNumber, 2);
        assert.equal(restarted.values.secret, undefined);
        for (const item of restarted.history) {
          assert.notEqual(item.changes.secret?.after, changedValues.secret);
          assert(!item.files.some((file) => file.id === nextFile.id));
        }
        await download(request.id, nextFile, b, 403);
        await decide(request.id, b);
        await decide(request.id, a);
        assert.equal(
          (await detail(request.id, b.token)).values.secret,
          changedValues.secret,
        );
        await download(request.id, nextFile, b, 200);
        await decide(request.id, b);
        await decide(request.id, c);
      },
    );
  } finally {
    const requests = ids(made.requests);
    const definitions = ids(made.definitions);
    isolatedSql(`START TRANSACTION;
      SELECT id FROM ops_event WHERE request_id IN (${requests}) FOR UPDATE;
      DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE FROM ops_notification WHERE target_type='APPROVAL' AND target_id IN (${requests});
      DELETE FROM ops_event WHERE request_id IN (${requests});
      DELETE FROM ops_flow_task WHERE request_id IN (${requests});
      DELETE FROM ops_flow_decision WHERE request_id IN (${requests});
      DELETE FROM ops_request_step WHERE request_id IN (${requests});
      DELETE FROM ops_request_file WHERE request_id IN (${requests});
      DELETE FROM ops_flow_request WHERE id IN (${requests});
      DELETE FROM ops_flow_step WHERE definition_id IN (${definitions});
      DELETE FROM ops_flow_version WHERE definition_id IN (${definitions});
      DELETE FROM ops_flow_delegation WHERE id IN (${ids(made.delegations)});
      DELETE FROM ops_flow_definition WHERE id IN (${definitions}); COMMIT;`);
    await purgeTestFiles(base, admin, made.files);
    for (const id of made.users)
      await call(`/system/users/${id}`, admin, "DELETE");
    for (const id of made.roles)
      await call(`/system/roles/${id}`, admin, "DELETE");
    if (category)
      await call(
        `/system/entries/approvalcategories/${category.id}`,
        admin,
        "DELETE",
      );
    if (department)
      await call(
        `/system/entries/departments/${department.id}`,
        admin,
        "DELETE",
      );
    await call("/auth/logout", admin, "POST");
  }
});
