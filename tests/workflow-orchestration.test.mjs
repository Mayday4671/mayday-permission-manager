/**
 * 并行及子流程真实事务回归，仅运行在白名单隔离项目。测试通过正常权限接口创建模型和申请，
 * 结束时精确登记并按子申请到父申请的顺序清理，不放宽生产删除规则或触碰原业务数据。
 */
import { isolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE,
  project = process.env.API_TEST_COMPOSE_PROJECT,
  database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = "qa_orch_" + Date.now().toString(36),
  password = "OrchestrationQa_2026!";
const made = {
  users: [],
  roles: [],
  definitions: [],
  requests: [],
  delegations: [],
};
const ids = (list) => {
  assert(list.every(Number.isSafeInteger));
  return list.length ? list.join(",") : "-1";
};
function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  return isolatedSql(statement, { maxBuffer: 2e6 });
}
async function call(path, token, method = "GET", body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    method + " " + path + ": " + JSON.stringify(data),
  );
  return data.data;
}
const field = {
  id: "memo",
  label: "说明",
  type: "TEXT",
  required: true,
  width: 24,
  maxLength: 100,
};
const end = { id: "end", name: "结束", type: "END" };
const approval = (id, user, next, extra = {}) => ({
  id,
  name: id,
  type: "APPROVAL",
  source: "USERS",
  assigneeIds: [user.id],
  mode: "ALL",
  next,
  readable: ["memo"],
  writable: [],
  actions: ["APPROVE", "REJECT", "RETURN", "COMMENT", "TRANSFER", "ADD_SIGN"],
  ...extra,
});
const spec = (nodes, extra = {}) => ({
  fields: [field],
  nodes: [...nodes, end],
  startNodeId: nodes[0].id,
  applicantType: "ALL",
  applicantIds: [],
  allowSelfApproval: false,
  allowRepeatApproval: false,
  allowWithdraw: true,
  ...extra,
});

test("持久并行、固定子流程、传播与恢复", { skip: !isolated }, async (t) => {
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  let dept;
  try {
    dept = await call("/system/entries/departments", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    const user = async (label, approver, roleExtra = {}, userExtra = {}) => {
      const role = await call("/system/roles", admin, "POST", {
        name: prefix + label,
        code: prefix + label,
        enabled: true,
        permissions: approver
          ? ["requests:view", "requests:approve", "users:view", "messages:view"]
          : ["requests:view", "requests:create", "messages:view"],
        dataScopes: { users: "ALL" },
        ...roleExtra,
      });
      made.roles.push(role.id);
      const account = await call("/system/users", admin, "POST", {
        username: prefix + label,
        nickname: label,
        password,
        enabled: true,
        departmentId: dept.id,
        roleIds: [role.id],
        ...userExtra,
      });
      made.users.push(account.id);
      return {
        ...account,
        token: (await loginWithCaptcha(base, account.username, password)).token,
      };
    };
    const applicant = await user("app", false),
      a = await user("a", true),
      b = await user("b", true),
      c = await user("c", true),
      d = await user("d", true),
      outsider = await user("out", false);
    const category = (await call("/system/entries/approvalcategories", admin))
      .items[0];
    const draft = async (schema) => {
      const record = await call("/operations/workflows", admin, "POST", {
        name: prefix + " " + made.definitions.length,
        code: prefix + "_" + made.definitions.length,
        categoryId: category.id,
        businessType: "GENERAL",
        enabled: true,
        schema,
      });
      made.definitions.push(record.id);
      return record;
    };
    const publish = async (schema) => {
      const record = await draft(schema);
      return call(`/operations/workflows/${record.id}/publish`, admin, "POST", {
        version: record.version,
      });
    };
    const detail = (id, token = admin) =>
      call(`/operations/requests/${id}`, token);
    const submit = async (
      definition,
      values = { memo: "并行验收" },
      who = applicant,
    ) => {
      const request = await call("/operations/requests", who.token, "POST", {
        definitionId: definition.id,
        versionId: definition.publishedVersionId,
        title: prefix + " 申请 " + made.requests.length,
        values,
      });
      made.requests.push(request.id);
      return request;
    };
    const decide = async (
      id,
      who,
      action = "APPROVE",
      extra = {},
      status = 200,
    ) => {
      const current = await detail(id, who.token);
      return call(
        `/operations/requests/${id}/decision`,
        who.token,
        "POST",
        {
          version: current.version,
          taskId: current.myTaskId,
          action,
          comment: "验收意见",
          ...extra,
        },
        status,
      );
    };
    const enable = async (account, enabled) => {
      await call("/system/users/status", admin, "PUT", {
        rows: [
          {
            id: account.id,
            version: (
              await call(
                "/system/users?keyword=" + encodeURIComponent(account.username),
                admin,
              )
            ).items.find((item) => item.id === account.id).version,
          },
        ],
        enabled,
      });
      // 停用即时撤销原会话；重新启用不能复活旧 JWT，后续测试按真实客户端重新验证登录。
      if (enabled)
        account.token = (
          await loginWithCaptcha(base, account.username, password)
        ).token;
    };
    const parallel = () =>
      spec([
        {
          id: "fork",
          name: "并行",
          type: "PARALLEL",
          next: "join",
          branches: ["left", "right"],
        },
        approval("left", a, "join"),
        approval("right", b, "join"),
        { id: "join", name: "汇合", type: "JOIN", next: "after" },
        approval("after", c, "end"),
      ]);

    await t.test(
      "同人并行可选右支路，字段、动作与退回路径由选定待办隔离",
      async () => {
        const schema = spec(
          [
            {
              id: "fork",
              name: "并行",
              type: "PARALLEL",
              next: "join",
              branches: ["leftGate", "rightGate"],
            },
            approval("leftGate", b, "left"),
            approval("rightGate", c, "right"),
            approval("left", a, "join", {
              readable: ["memo", "leftNote"],
              writable: ["leftNote"],
              actions: ["APPROVE", "REJECT", "COMMENT"],
            }),
            approval("right", a, "join", {
              readable: ["memo", "rightNote"],
              writable: ["rightNote"],
              actions: ["APPROVE", "RETURN", "REJECT"],
            }),
            { id: "join", name: "汇合", type: "JOIN", next: "end" },
          ],
          {
            allowRepeatApproval: true,
            fields: [
              field,
              { ...field, id: "leftNote", label: "左意见" },
              { ...field, id: "rightNote", label: "右意见" },
            ],
          },
        );
        const definition = await publish(schema);
        const request = await submit(definition, {
          memo: "并行选择",
          leftNote: "左原值",
          rightNote: "右原值",
        });
        await decide(request.id, b);
        await decide(request.id, c);
        const initial = await detail(request.id, a.token);
        assert.equal(initial.myTasks.length, 2);
        const left = initial.myTasks.find((task) => task.nodeId === "left"),
          right = initial.myTasks.find((task) => task.nodeId === "right");
        assert.equal(initial.myTaskId, left.id);
        const chosen = await call(
          `/operations/requests/${request.id}?taskId=${right.id}`,
          a.token,
        );
        assert.equal(chosen.myTaskId, right.id);
        assert.deepEqual(chosen.writable, ["rightNote"]);
        assert(chosen.actions.includes("RETURN"));
        assert.equal(chosen.actions.includes("COMMENT"), false);
        assert.deepEqual(
          chosen.returnTargets.map((target) => target.id),
          ["rightGate"],
        );
        const oldGate = chosen.tasks.find(
          (task) => task.nodeId === "rightGate",
        ).id;
        await call(
          `/operations/requests/${request.id}?taskId=${oldGate}`,
          a.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${request.id}?taskId=${right.id}`,
          b.token,
          "GET",
          undefined,
          403,
        );
        const send = (body, status) =>
          call(
            `/operations/requests/${request.id}/decision`,
            a.token,
            "POST",
            {
              version: chosen.version,
              taskId: right.id,
              comment: "选定右支路",
              ...body,
            },
            status,
          );
        await send({ action: "COMMENT" }, 403);
        await send(
          { action: "APPROVE", values: { leftNote: "越界修改" } },
          403,
        );
        await send({ action: "RETURN", targetNodeId: "leftGate" }, 400);
        await send(
          { action: "APPROVE", values: { rightNote: "右支路先办理" } },
          200,
        );
        const after = await detail(request.id, a.token);
        assert.equal(after.myTaskId, left.id);
        assert.equal(after.values.leftNote, "左原值");
        assert.equal(after.values.rightNote, "右支路先办理");
        await call(
          `/operations/requests/${request.id}?taskId=${right.id}`,
          a.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${request.id}/decision`,
          a.token,
          "POST",
          { version: after.version, taskId: right.id, action: "APPROVE" },
          403,
        );
        const other = await submit(definition, {
          memo: "另一申请",
          leftNote: "左",
          rightNote: "右",
        });
        await call(
          `/operations/requests/${other.id}?taskId=${left.id}`,
          admin,
          "GET",
          undefined,
          403,
        );
        await decide(request.id, a, "APPROVE", {
          values: { leftNote: "左支路后办理" },
        });
        assert.equal((await detail(request.id)).status, "APPROVED");

        await decide(other.id, b);
        await decide(other.id, c);
        const remaining = await detail(other.id, a.token),
          selected = remaining.myTasks.find((task) => task.nodeId === "right"),
          keep = remaining.myTasks.find((task) => task.nodeId === "left");
        await call(
          `/operations/requests/${other.id}/decision`,
          a.token,
          "POST",
          {
            version: remaining.version,
            taskId: selected.id,
            action: "RETURN",
            targetNodeId: "rightGate",
            comment: "右支路补充",
          },
        );
        assert.equal((await detail(other.id, a.token)).myTaskId, keep.id);
        await decide(other.id, c);
        await decide(other.id, a);
        await decide(other.id, a);
        assert.equal((await detail(other.id)).status, "APPROVED");
      },
    );

    await t.test("全部支路完成才汇合，未来人员与未参与者不能读取", async () => {
      const definition = await publish(parallel()),
        request = await submit(definition);
      assert.equal(
        request.tasks.filter((task) => task.status === "PENDING").length,
        2,
      );
      await detail(request.id, c.token).then(
        () => assert.fail("未来人员不可读"),
        (error) => assert.match(error.message, /403/),
      );
      await call(
        `/operations/requests/${request.id}`,
        outsider.token,
        "GET",
        undefined,
        403,
      );
      await decide(request.id, a);
      let current = await detail(request.id);
      assert.equal(current.status, "PENDING");
      assert.equal(
        current.tasks.filter((task) => task.nodeId === "after").length,
        0,
      );
      await decide(request.id, b);
      current = await detail(request.id);
      assert.equal(
        current.tasks.filter(
          (task) => task.nodeId === "after" && task.status === "PENDING",
        ).length,
        1,
      );
      await decide(request.id, c);
      assert.equal((await detail(request.id)).status, "APPROVED");
    });
    await t.test("同版本并发决定一项冲突，重试只产生一次汇合待办", async () => {
      const request = await submit(await publish(parallel()));
      const [left, right] = await Promise.all([
        detail(request.id, a.token),
        detail(request.id, b.token),
      ]);
      const results = await Promise.all(
        [
          [a, left],
          [b, right],
        ].map(async ([who, current]) => {
          const response = await fetch(
            base + `/operations/requests/${request.id}/decision`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + who.token,
              },
              body: JSON.stringify({
                version: current.version,
                taskId: current.myTaskId,
                action: "APPROVE",
              }),
            },
          );
          return { who, status: response.status };
        }),
      );
      assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
      await decide(request.id, results.find((item) => item.status === 409).who);
      const current = await detail(request.id);
      assert.equal(
        current.tasks.filter((task) => task.nodeId === "after").length,
        1,
      );
      await decide(request.id, c);
      assert.equal((await detail(request.id)).status, "APPROVED");
    });
    await t.test("嵌套并行内层到齐仍等待外层，汇合不能重复释放", async () => {
      const definition = await publish(
        spec([
          {
            id: "outer",
            name: "外层并行",
            type: "PARALLEL",
            next: "outerJoin",
            branches: ["inner", "outerReview"],
          },
          {
            id: "inner",
            name: "内层并行",
            type: "PARALLEL",
            next: "innerJoin",
            branches: ["innerA", "innerB"],
          },
          approval("innerA", a, "innerJoin"),
          approval("innerB", b, "innerJoin"),
          {
            id: "innerJoin",
            name: "内层汇合",
            type: "JOIN",
            next: "outerJoin",
          },
          approval("outerReview", c, "outerJoin"),
          { id: "outerJoin", name: "外层汇合", type: "JOIN", next: "after" },
          approval("after", d, "end"),
        ]),
      );
      const request = await submit(definition);
      assert.equal(
        request.tasks.filter((task) => task.status === "PENDING").length,
        3,
      );
      await decide(request.id, a);
      await decide(request.id, b);
      assert.equal(
        (await detail(request.id)).tasks.filter(
          (task) => task.nodeId === "after",
        ).length,
        0,
      );
      await decide(request.id, c);
      await decide(request.id, d);
      assert.equal((await detail(request.id)).status, "APPROVED");
    });
    await t.test(
      "本支路退回保持另一支路，跨支路目标拒绝，并行前退回废弃全部支路",
      async () => {
        const definition = await publish(
          spec([
            approval("gate", d, "fork"),
            {
              id: "fork",
              name: "并行",
              type: "PARALLEL",
              next: "join",
              branches: ["left", "right"],
            },
            approval("left", a, "leftNext"),
            approval("leftNext", b, "join"),
            approval("right", c, "join"),
            { id: "join", name: "汇合", type: "JOIN", next: "end" },
          ]),
        );
        const request = await submit(definition);
        await decide(request.id, d);
        await decide(request.id, a);
        const right = (await detail(request.id, c.token)).myTaskId;
        await decide(request.id, b, "RETURN", { targetNodeId: "left" });
        assert.equal((await detail(request.id, c.token)).myTaskId, right);
        await decide(request.id, a);
        await decide(request.id, c, "RETURN", { targetNodeId: "left" }, 400);
        await decide(request.id, c, "RETURN", { targetNodeId: "gate" });
        let current = await detail(request.id);
        assert.deepEqual(
          current.tasks
            .filter((task) => task.status === "PENDING")
            .map((task) => task.nodeId),
          ["gate"],
        );
        await decide(request.id, d);
        await decide(request.id, a);
        await decide(request.id, b);
        await decide(request.id, c);
        current = await detail(request.id);
        assert.equal(current.status, "APPROVED");
      },
    );
    await t.test(
      "非法并行图、重复人员、冲突写字段和错误子映射发布拒绝",
      async () => {
        for (const mutate of [
          (model) =>
            (model.nodes.find((node) => node.id === "right").next = "end"),
          (model) =>
            (model.nodes.find((node) => node.id === "right").assigneeIds = [
              a.id,
            ]),
          (model) => {
            model.nodes.find((node) => node.id === "left").writable = ["memo"];
            model.nodes.find((node) => node.id === "right").writable = ["memo"];
          },
        ]) {
          const model = parallel();
          mutate(model);
          const record = await draft(model);
          await call(
            `/operations/workflows/${record.id}/publish`,
            admin,
            "POST",
            { version: record.version },
            400,
          );
        }
      },
    );
    await t.test(
      "并行前退回废弃已完成支路，重开后旧通过不能放行新汇合",
      async () => {
        const definition = await publish(
          spec([
            approval("gate", d, "fork"),
            {
              id: "fork",
              name: "并行",
              type: "PARALLEL",
              next: "join",
              branches: ["left", "right"],
            },
            approval("left", a, "join"),
            approval("right", b, "join"),
            { id: "join", name: "汇合", type: "JOIN", next: "end" },
          ]),
        );
        const request = await submit(definition);
        await decide(request.id, d);
        await decide(request.id, a);
        await decide(request.id, b, "RETURN", { targetNodeId: "gate" });
        await decide(request.id, d);
        await decide(request.id, b);
        const current = await detail(request.id);
        assert.equal(current.status, "PENDING");
        assert.equal(
          current.tasks.filter(
            (task) => task.nodeId === "left" && task.status === "PENDING",
          ).length,
          1,
        );
        assert.equal(
          current.tasks.filter(
            (task) => task.nodeId === "left" && task.status === "APPROVED",
          ).length,
          1,
        );
        await decide(request.id, a);
        assert.equal((await detail(request.id)).status, "APPROVED");
      },
    );
    const resultField = {
      id: "result",
      label: "结果",
      type: "NUMBER",
      required: false,
      width: 24,
      min: 0,
      max: 100,
    };
    const childModel = (who) =>
      spec(
        [
          approval("review", who, "end", {
            readable: ["memo", "result"],
            writable: ["result"],
          }),
        ],
        { fields: [field, resultField] },
      );
    const parentModel = (child) =>
      spec(
        [
          {
            id: "child",
            name: "子流程",
            type: "SUBPROCESS",
            next: "end",
            readable: ["memo", "result"],
            writable: ["result"],
            actions: [],
            subprocess: {
              versionId: child.publishedVersionId,
              inputs: { memo: "memo", result: "result" },
              outputs: { result: "result" },
            },
          },
        ],
        { fields: [field, resultField] },
      );
    await t.test(
      "子映射发布验证必填输入、类型、读写授权和递归调用",
      async () => {
        const child = await publish(childModel(a));
        for (const mutate of [
          (model) => delete model.nodes[0].subprocess.inputs.memo,
          (model) => (model.nodes[0].subprocess.inputs.memo = "result"),
          (model) => (model.nodes[0].writable = []),
          (model) => (model.nodes[0].readable = []),
        ]) {
          const model = parentModel(child);
          mutate(model);
          const record = await draft(model);
          await call(
            `/operations/workflows/${record.id}/publish`,
            admin,
            "POST",
            { version: record.version },
            400,
          );
        }
        let recursive = await call(
          `/operations/workflows/${child.id}`,
          admin,
          "PUT",
          { ...child, schema: parentModel(child), version: child.version },
        );
        await call(
          `/operations/workflows/${child.id}/publish`,
          admin,
          "POST",
          { version: recursive.version },
          400,
        );
      },
    );
    await t.test(
      "固定子版本、独立参与权、审批输出回填及不可直接修改子申请",
      async () => {
        let child = await publish(childModel(a));
        const parent = await publish(parentModel(child));
        child = await call(`/operations/workflows/${child.id}`, admin, "PUT", {
          ...child,
          schema: childModel(b),
          version: child.version,
        });
        child = await call(
          `/operations/workflows/${child.id}/publish`,
          admin,
          "POST",
          { version: child.version },
        );
        const request = await submit(parent, { memo: "子流程", result: 1 }),
          childId = request.childRequests[0].id;
        let instance = await detail(childId, a.token);
        assert.equal(
          instance.definitionVersionId,
          parent.schema.nodes[0].subprocess.versionId,
        );
        await call(
          `/operations/requests/${request.id}`,
          a.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${childId}`,
          b.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${childId}`,
          applicant.token,
          "PUT",
          {
            version: instance.version,
            title: "不能独立修改",
            values: { memo: "篡改", result: 2 },
          },
          403,
        );
        await decide(childId, a, "APPROVE", { values: { result: 42 } });
        const current = await detail(request.id);
        assert.equal(current.status, "APPROVED");
        assert.equal(current.values.result, "42");
        assert.equal(current.childRequests[0].status, "APPROVED");
      },
    );
    await t.test(
      "子依赖停用持久失败，管理员恢复仍使用原固定版本且不重复生成",
      async () => {
        let child = await publish(childModel(a));
        const parent = await publish(parentModel(child));
        child = await call(`/operations/workflows/${child.id}`, admin, "PUT", {
          ...child,
          enabled: false,
          version: child.version,
        });
        const request = await submit(parent, { memo: "恢复", result: 3 });
        assert.equal(request.status, "PENDING");
        assert.equal(request.canRecover, false);
        assert.equal(request.childRequests.length, 0);
        let current = await detail(request.id);
        assert(current.execution.some((token) => token.status === "FAILED"));
        await call(
          `/operations/requests/${request.id}/recover`,
          applicant.token,
          "POST",
          { version: current.version, reason: "越权恢复" },
          403,
        );
        child = await call(`/operations/workflows/${child.id}`, admin, "PUT", {
          ...child,
          enabled: true,
          version: child.version,
        });
        current = await call(
          `/operations/requests/${request.id}/recover`,
          admin,
          "POST",
          { version: current.version, reason: "已启用原子流程" },
        );
        assert.equal(current.childRequests.length, 1);
        await call(
          `/operations/requests/${request.id}/recover`,
          admin,
          "POST",
          { version: current.version, reason: "重复恢复" },
          400,
        );
        await decide(current.childRequests[0].id, a);
        assert.equal((await detail(request.id)).status, "APPROVED");
      },
    );
    await t.test(
      "子流程下一人员失效可以交接恢复，已通过节点不重做",
      async () => {
        const child = await publish(
          spec([approval("first", a, "second"), approval("second", b, "end")], {
            fields: [field, resultField],
          }),
        );
        const parent = await publish(parentModel(child)),
          request = await submit(parent, { memo: "办理修复", result: 4 }),
          childId = request.childRequests[0].id;
        await enable(b, false);
        await decide(childId, a);
        let current = await detail(childId);
        assert.equal(current.canRecover, true);
        assert.equal(
          current.tasks.filter((task) => task.nodeId === "first").length,
          1,
        );
        current = await call(
          `/operations/requests/${childId}/handover`,
          admin,
          "POST",
          {
            version: current.version,
            fromUserId: b.id,
            targetUserId: c.id,
            reason: "失效人员交接",
          },
        );
        current = await call(
          `/operations/requests/${childId}/recover`,
          admin,
          "POST",
          { version: current.version, reason: "新审批人已交接" },
        );
        assert.equal(
          current.tasks.filter((task) => task.nodeId === "first").length,
          1,
        );
        await decide(childId, c);
        assert.equal((await detail(request.id)).status, "APPROVED");
        await enable(b, true);
      },
    );
    await t.test(
      "待启动子调用离职人员逐项修复、固定版本、权限范围及重提传播",
      async () => {
        const departedFirst = await user("departed_first", true),
          departedSecond = await user("departed_second", true),
          limited = await user("limited_manager", true, {
            permissions: [
              "requests:view",
              "requests:manage",
              "requests:reassign",
              "requests:approve",
              "users:view",
            ],
            dataScopes: { users: "SELF" },
          });
        const child = await publish(
          spec(
            [
              approval("first", departedFirst, "second"),
              approval("second", departedSecond, "end", {
                readable: ["memo", "result"],
                writable: ["result"],
              }),
            ],
            { fields: [field, resultField] },
          ),
        );
        const parent = await publish(parentModel(child));
        await enable(departedFirst, false);
        await enable(departedSecond, false);
        const request = await submit(parent, { memo: "离职修复", result: 5 });
        let current = await detail(request.id);
        assert.equal(current.childRequests.length, 0);
        assert.equal(current.canRepairSubprocess, true);
        const path = `/operations/requests/${request.id}`;
        await call(
          path + "/subprocess-repair-options",
          a.token,
          "GET",
          undefined,
          403,
        );
        await call(
          path + "/subprocess-repair-options",
          limited.token,
          "GET",
          undefined,
          403,
        );
        const options = await call(path + "/subprocess-repair-options", admin);
        assert.equal(options.length, 1);
        assert.equal(options[0].versionId, child.publishedVersionId);
        assert.equal(options[0].nodes[0].people[0].value, departedFirst.id);
        assert.match(options[0].nodes[0].people[0].label, /已停用/);
        const input = {
          version: current.version,
          tokenId: options[0].tokenId,
          childNodeId: "first",
          targetUserIds: [a.id],
          reason: "离职人员不可启用，改由有效审批人员接收",
        };
        await call(
          path + "/subprocess-repair",
          applicant.token,
          "POST",
          input,
          403,
        );
        await call(
          path + "/subprocess-repair",
          limited.token,
          "POST",
          input,
          403,
        );
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          { ...input, targetUserIds: [outsider.id] },
          400,
        );
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          { ...input, targetUserIds: [a.id, a.id] },
          400,
        );
        const firstSaved = await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          input,
        );
        assert.equal(firstSaved.childRequests.length, 0);
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          { ...input, childNodeId: "second", targetUserIds: [b.id] },
          409,
        );
        current = firstSaved;
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          {
            ...input,
            version: current.version,
            childNodeId: "second",
            targetUserIds: [a.id],
          },
          400,
        );
        // 第一节点的修复已提交，但第二节点仍失效：恢复失败持久化，不把修复回滚或错误创建子申请。
        current = await call(path + "/recover", admin, "POST", {
          version: current.version,
          reason: "校验未修复节点仍会暂停",
        });
        assert.equal(current.childRequests.length, 0);
        assert.equal(current.canRecover, true);
        current = await call(path + "/subprocess-repair", admin, "POST", {
          ...input,
          version: current.version,
          childNodeId: "second",
          targetUserIds: [b.id],
        });
        const audit = current.history.filter(
          (event) => event.action === "SUBPROCESS_REPAIR",
        );
        assert.equal(audit.length, 2);
        assert.equal(
          audit[0].subprocessRepair.versionId,
          child.publishedVersionId,
        );
        assert.equal(
          audit[0].subprocessRepair.before[0].value,
          departedFirst.id,
        );
        assert.equal(audit[0].subprocessRepair.after[0].value, a.id);
        assert.equal(
          (await detail(request.id, applicant.token)).history.find(
            (event) => event.action === "SUBPROCESS_REPAIR",
          ).subprocessRepair,
          undefined,
        );
        // 撤回再重提沿用原固定模型，保留仅属于此申请的待启动调用覆盖。
        await decide(request.id, applicant, "WITHDRAW");
        current = await detail(request.id, applicant.token);
        current = await call(path + "/submit", applicant.token, "POST", {
          version: current.version,
          title: current.title,
          values: current.values,
        });
        assert.equal(current.childRequests.length, 1);
        const childId = current.childRequests[0].id;
        let instance = await detail(childId);
        assert.equal(instance.definitionVersionId, child.publishedVersionId);
        assert.equal(
          instance.tasks.find((task) => task.status === "PENDING").assigneeId,
          a.id,
        );
        current = await detail(request.id);
        await call(
          path + "/recover",
          admin,
          "POST",
          { version: current.version, reason: "不能重复启动子申请" },
          400,
        );
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          { ...input, version: current.version },
          400,
        );
        await decide(childId, a);
        instance = await detail(childId, b.token);
        assert.equal(
          instance.tasks.find((task) => task.status === "PENDING").assigneeId,
          b.id,
        );
        await decide(childId, b, "APPROVE", { values: { result: 51 } });
        assert.equal((await detail(request.id)).status, "APPROVED");
        assert.equal((await detail(request.id)).values.result, "51");
        assert.equal(
          (
            await call(`/system/users?keyword=${departedFirst.username}`, admin)
          ).items.find((item) => item.id === departedFirst.id).enabled,
          false,
        );
        assert.equal(
          (
            await call(
              `/system/users?keyword=${departedSecond.username}`,
              admin,
            )
          ).items.find((item) => item.id === departedSecond.id).enabled,
          false,
        );
      },
    );
    await t.test(
      "已删除固定来源与抄送失效可修复，未知部门来源只允许全用户范围管理员",
      async () => {
        const removed = await user("deleted_source", true),
          departmentManager = await user("dept_mgr", true, {
            permissions: [
              "requests:view",
              "requests:manage",
              "requests:reassign",
              "users:view",
            ],
            dataScopes: { users: "DEPARTMENT" },
          });
        const child = await publish(
          spec(
            [
              {
                id: "copy",
                name: "抄送知会",
                type: "COPY",
                source: "USERS",
                assigneeIds: [removed.id],
                next: "review",
                readable: ["memo"],
                writable: [],
                actions: [],
              },
              approval("review", a, "end"),
            ],
            { fields: [field, resultField] },
          ),
        );
        const parent = await publish(parentModel(child));
        await call(`/system/users/${removed.id}`, admin, "DELETE");
        made.users.splice(made.users.indexOf(removed.id), 1);
        const request = await submit(parent, {
          memo: "抄送来源已删除",
          result: 6,
        });
        let current = await detail(request.id);
        const path = `/operations/requests/${request.id}`;
        assert.equal(current.childRequests.length, 0);
        await call(
          path + "/subprocess-repair-options",
          departmentManager.token,
          "GET",
          undefined,
          403,
        );
        const option = (
          await call(path + "/subprocess-repair-options", admin)
        )[0];
        const copy = option.nodes.find((node) => node.id === "copy");
        assert.equal(copy.type, "COPY");
        assert.match(copy.people[0].label, /已删除账号/);
        const input = {
          version: current.version,
          tokenId: option.tokenId,
          childNodeId: "copy",
          targetUserIds: [outsider.id],
          reason: "抄送来源删除后指定有效接收人",
        };
        await call(
          path + "/subprocess-repair",
          departmentManager.token,
          "POST",
          input,
          403,
        );
        await call(
          path + "/subprocess-repair",
          admin,
          "POST",
          { ...input, targetUserIds: [999999999] },
          400,
        );
        current = await call(path + "/subprocess-repair", admin, "POST", input);
        assert.match(
          current.history.find((event) => event.action === "SUBPROCESS_REPAIR")
            .subprocessRepair.before[0].label,
          /已删除账号/,
        );
        current = await call(path + "/recover", admin, "POST", {
          version: current.version,
          reason: "抄送人员已修复",
        });
        const childId = current.childRequests[0].id;
        const instance = await detail(childId, outsider.token);
        assert.equal(
          instance.tasks.find((task) => task.kind === "COPY").assigneeId,
          outsider.id,
        );
        assert.equal(instance.actions.length, 0);
        await decide(childId, a);
        assert.equal((await detail(request.id)).status, "APPROVED");
      },
    );
    await t.test(
      "修复目标独立校验部门范围及具有审批权申请人的禁止自审规则",
      async () => {
        const selfApplicant = await user("self_applicant", true, {
            permissions: [
              "requests:view",
              "requests:approve",
              "requests:create",
            ],
          }),
          old = await user("self_old", true),
          scoped = await user("target_mgr", true, {
            permissions: [
              "requests:view",
              "requests:manage",
              "requests:reassign",
              "users:view",
            ],
            dataScopes: { users: "DEPARTMENT" },
          }),
          remote = await user("out_dept", true, {}, { departmentId: null });
        const child = await publish(childModel(old)),
          parent = await publish(parentModel(child));
        await enable(old, false);
        const request = await submit(
            parent,
            { memo: "独立自审和范围校验", result: 7 },
            selfApplicant,
          ),
          current = await detail(request.id),
          path = `/operations/requests/${request.id}`;
        const option = (
          await call(path + "/subprocess-repair-options", scoped.token)
        )[0];
        const input = {
          version: current.version,
          tokenId: option.tokenId,
          childNodeId: "review",
          targetUserIds: [selfApplicant.id],
          reason: "禁止自审与越范围目标",
        };
        await call(path + "/subprocess-repair", admin, "POST", input, 400);
        await call(
          path + "/subprocess-repair",
          scoped.token,
          "POST",
          { ...input, targetUserIds: [remote.id] },
          403,
        );
        const saved = await call(
          path + "/subprocess-repair",
          scoped.token,
          "POST",
          { ...input, targetUserIds: [a.id] },
        );
        const recovered = await call(path + "/recover", admin, "POST", {
          version: saved.version,
          reason: "合法范围接收人已配置",
        });
        await decide(recovered.childRequests[0].id, a);
        assert.equal((await detail(request.id)).status, "APPROVED");
      },
    );
    await t.test(
      "旧单线与已创建子申请的后续抄送失效可交接，不扩授审批权或改写已办记录",
      async () => {
        for (const kind of ["legacy", "child"]) {
          const recipient = await user("copy_" + kind, false);
          const model = spec(
            [
              approval("first", a, "copy"),
              {
                id: "copy",
                name: "后续抄送",
                type: "COPY",
                source: "USERS",
                assigneeIds: [recipient.id],
                next: "last",
                readable: ["memo"],
                writable: [],
                actions: [],
              },
              approval("last", c, "end"),
            ],
            { fields: [field, resultField] },
          );
          const definition = await publish(model);
          const root = await submit(
            kind === "child"
              ? await publish(parentModel(definition))
              : definition,
            { memo: "后续抄送失效", result: 8 },
          );
          const id = kind === "child" ? root.childRequests[0].id : root.id;
          const before = await detail(id);
          const firstTask = before.tasks.find(
            (task) => task.status === "PENDING",
          );
          await call(`/system/users/${recipient.id}`, admin, "DELETE");
          made.users.splice(made.users.indexOf(recipient.id), 1);
          // 旧 null 游标实例保留原事务语义，下一节点失效会回滚本次决定；持久子申请保存失败游标。
          await decide(id, a, "APPROVE", {}, kind === "legacy" ? 400 : 200);
          let current = await detail(id);
          assert.equal(
            current.tasks.find((task) => task.id === firstTask.id).status,
            kind === "legacy" ? "PENDING" : "APPROVED",
          );
          assert.equal(current.canRecover, kind === "child");
          assert.match(
            current.handoverSources.find(
              (person) => person.value === recipient.id,
            ).label,
            /已删除账号/,
          );
          current = await call(
            `/operations/requests/${id}/handover`,
            admin,
            "POST",
            {
              version: current.version,
              fromUserId: recipient.id,
              targetUserId: outsider.id,
              reason: "未来抄送接收人删除后交接给仅有查看权的有效账号",
            },
          );
          if (kind === "child")
            current = await call(
              `/operations/requests/${id}/recover`,
              admin,
              "POST",
              {
                version: current.version,
                reason: "抄送来源已交接，继续原子流程游标",
              },
            );
          else await decide(id, a);
          current = await detail(id, outsider.token);
          assert.equal(current.actions.length, 0);
          assert.equal(
            current.tasks.filter((task) => task.kind === "COPY").length,
            1,
          );
          assert.equal(
            current.tasks.find((task) => task.kind === "COPY").assigneeId,
            outsider.id,
          );
          assert.equal(
            current.tasks.filter((task) => task.nodeId === "first").length,
            1,
          );
          await decide(id, c);
          assert.equal((await detail(root.id)).status, "APPROVED");
        }
      },
    );
    await t.test(
      "父撤回、管理员终止和子退回传播；重提新子申请保留历史",
      async () => {
        const child = await publish(childModel(a)),
          parent = await publish(parentModel(child));
        const withdrawn = await submit(parent, { memo: "撤回", result: 1 });
        await decide(withdrawn.id, applicant, "WITHDRAW");
        assert.equal(
          (await detail(withdrawn.childRequests[0].id)).status,
          "CANCELLED",
        );
        const terminated = await submit(parent, { memo: "终止", result: 1 });
        const before = await detail(terminated.id);
        await call(
          `/operations/requests/${terminated.id}/decision`,
          admin,
          "POST",
          {
            version: before.version,
            action: "TERMINATE",
            comment: "取消父申请",
          },
        );
        assert.equal(
          (await detail(terminated.childRequests[0].id)).status,
          "CANCELLED",
        );
        const returned = await submit(parent, { memo: "退回", result: 1 });
        await decide(returned.childRequests[0].id, a, "RETURN");
        let current = await detail(returned.id, applicant.token);
        assert.equal(current.status, "RETURNED");
        assert.equal(
          (await detail(returned.childRequests[0].id)).status,
          "RETURNED",
          "自然退回的子结果不得被父回调改写为取消",
        );
        current = await call(
          `/operations/requests/${returned.id}/submit`,
          applicant.token,
          "POST",
          {
            version: current.version,
            title: returned.title,
            values: { memo: "补充后重提", result: 2 },
          },
        );
        assert.equal(current.childRequests.length, 2);
        assert.equal(
          current.childRequests.filter((item) => item.status === "PENDING")
            .length,
          1,
        );
        await decide(
          current.childRequests.find((item) => item.status === "PENDING").id,
          a,
        );
        assert.equal((await detail(returned.id)).status, "APPROVED");
      },
    );
    await t.test(
      "并行前退回同时取消活动子申请，旧子待办不可决定新轮",
      async () => {
        const child = await publish(childModel(a));
        const parent = await publish(
          spec(
            [
              approval("gate", d, "fork"),
              {
                id: "fork",
                name: "并行",
                type: "PARALLEL",
                next: "join",
                branches: ["child", "right"],
              },
              { ...parentModel(child).nodes[0], next: "join" },
              approval("right", b, "join"),
              { id: "join", name: "汇合", type: "JOIN", next: "end" },
            ],
            { fields: [field, resultField] },
          ),
        );
        const request = await submit(parent, { memo: "子树退回", result: 1 });
        await decide(request.id, d);
        const before = await detail(request.id),
          oldChild = before.childRequests[0].id,
          oldTask = await detail(oldChild, a.token);
        await decide(request.id, b, "RETURN", { targetNodeId: "gate" });
        assert.equal((await detail(oldChild)).status, "CANCELLED");
        await call(
          `/operations/requests/${oldChild}/decision`,
          a.token,
          "POST",
          {
            version: oldTask.version,
            taskId: oldTask.myTaskId,
            action: "APPROVE",
          },
          409,
        );
        await decide(request.id, d);
        const restarted = await detail(request.id);
        assert.equal(restarted.childRequests.length, 2);
        await decide(
          restarted.childRequests.find((row) => row.status === "PENDING").id,
          a,
        );
        await decide(request.id, b);
        assert.equal((await detail(request.id)).status, "APPROVED");
      },
    );

    await t.test(
      "手动催办覆盖真实活动支路并保持权限、冷却与轮次边界",
      async (reminders) => {
        const reminderApplicant = await user("rem_app", false, {
          permissions: [
            "requests:view",
            "requests:create",
            "requests:remind",
            "messages:view",
          ],
        });
        const sendReminder = (
          request,
          version,
          status = 200,
          who = reminderApplicant,
        ) =>
          call(
            "/operations/requests/" + request.id + "/remind",
            who.token,
            "POST",
            { version },
            status,
          );
        // 只读取本轮登记申请的事务发件箱，验证实际收件人，而非复写待办过滤实现或依赖异步投递时机。
        const reminderRecipients = (request) => {
          assert(made.requests.includes(request.id), "只能读取本次登记的申请");
          return sql(
            "SELECT recipient_id FROM ops_event WHERE request_id=" +
              request.id +
              " AND event_key LIKE 'reminder:%' ORDER BY recipient_id,id;",
          )
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(Number);
        };
        const expectRecipients = (request, expected) =>
          assert.deepEqual(
            reminderRecipients(request),
            [...expected].sort((left, right) => left - right),
          );

        await reminders.test(
          "不同并行处理人均收到，旧版本与冷却不产生重复事件",
          async () => {
            const request = await submit(
              await publish(parallel()),
              { memo: "并行催办" },
              reminderApplicant,
            );
            assert.equal(request.canRemind, true);
            await sendReminder(request, request.version, 403, outsider);
            expectRecipients(request, []);
            await sendReminder(request, request.version);
            expectRecipients(request, [a.id, b.id]);
            const current = await detail(request.id, reminderApplicant.token);
            assert.equal(current.canRemind, false);
            assert.equal(
              current.remindUnavailableReason,
              "每项申请 30 分钟内只能催办一次",
            );
            assert(current.lastRemindedAt);
            await sendReminder(request, request.version, 409);
            await sendReminder(request, current.version, 400);
            expectRecipients(request, [a.id, b.id]);

            const partial = await submit(
              await publish(parallel()),
              { memo: "仅剩右支路" },
              reminderApplicant,
            );
            await decide(partial.id, a);
            const after = await detail(partial.id, reminderApplicant.token);
            await sendReminder(partial, after.version);
            expectRecipients(partial, [b.id]);
          },
        );

        await reminders.test(
          "同一人在两条活动支路只收到一条申请提醒",
          async () => {
            const model = parallel();
            model.allowRepeatApproval = true;
            model.nodes.find((node) => node.id === "right").assigneeIds = [
              a.id,
            ];
            const request = await submit(
              await publish(model),
              { memo: "同人双待办" },
              reminderApplicant,
            );
            assert.equal((await detail(request.id, a.token)).myTasks.length, 2);
            await sendReminder(request, request.version);
            expectRecipients(request, [a.id]);
          },
        );

        await reminders.test(
          "嵌套并行同时通知全部叶子审批人，不催未来汇合节点",
          async () => {
            const definition = await publish(
              spec([
                {
                  id: "outer",
                  name: "外层并行",
                  type: "PARALLEL",
                  next: "outerJoin",
                  branches: ["inner", "right"],
                },
                {
                  id: "inner",
                  name: "内层并行",
                  type: "PARALLEL",
                  next: "innerJoin",
                  branches: ["innerLeft", "innerRight"],
                },
                approval("innerLeft", a, "innerJoin"),
                approval("innerRight", b, "innerJoin"),
                {
                  id: "innerJoin",
                  name: "内层汇合",
                  type: "JOIN",
                  next: "outerJoin",
                },
                approval("right", c, "outerJoin"),
                {
                  id: "outerJoin",
                  name: "外层汇合",
                  type: "JOIN",
                  next: "after",
                },
                approval("after", d, "end"),
              ]),
            );
            const request = await submit(
              definition,
              { memo: "嵌套催办" },
              reminderApplicant,
            );
            await sendReminder(request, request.version);
            expectRecipients(request, [a.id, b.id, c.id]);
          },
        );

        await reminders.test(
          "旧单线顺签仅催已激活人员，排队与抄送不被催办",
          async () => {
            const definition = await publish(
              spec([
                {
                  id: "copy",
                  name: "知会",
                  type: "COPY",
                  source: "USERS",
                  assigneeIds: [c.id],
                  next: "review",
                  readable: ["memo"],
                  writable: [],
                  actions: [],
                },
                approval("review", a, "end", {
                  assigneeIds: [a.id, b.id],
                  mode: "SERIAL",
                }),
              ]),
            );
            const request = await submit(
              definition,
              { memo: "顺签催办" },
              reminderApplicant,
            );
            const current = await detail(request.id);
            assert(
              current.tasks.some(
                (task) => task.assigneeId === b.id && task.status === "WAITING",
              ),
            );
            assert(
              current.tasks.some(
                (task) => task.assigneeId === c.id && task.kind === "COPY",
              ),
            );
            await sendReminder(request, request.version);
            expectRecipients(request, [a.id]);
            await decide(request.id, a);
            assert((await detail(request.id, b.token)).myTaskId);
            const later = await detail(request.id, reminderApplicant.token);
            assert.equal(
              later.canRemind,
              false,
              "进入下一顺签人也不能绕过申请级冷却",
            );
            await sendReminder(request, later.version, 400);
            expectRecipients(request, [a.id]);
          },
        );

        await reminders.test(
          "纯等待子流程和失败父游标不展示或接受无目标催办",
          async () => {
            let child = await publish(childModel(a));
            const parent = await publish(parentModel(child));
            const waiting = await submit(
              parent,
              { memo: "等待子流程", result: 1 },
              reminderApplicant,
            );
            for (const token of [reminderApplicant.token, admin]) {
              const current = await detail(waiting.id, token);
              assert.equal(current.canRemind, false);
              assert.equal(
                current.remindUnavailableReason,
                "当前没有可催办的待办",
              );
              assert(
                current.execution.some((item) => item.status === "WAIT_CHILD"),
              );
            }
            await sendReminder(waiting, waiting.version, 400);
            expectRecipients(waiting, []);
            child = await call(
              "/operations/workflows/" + child.id,
              admin,
              "PUT",
              {
                ...child,
                enabled: false,
                version: child.version,
              },
            );
            const failed = await submit(
              parent,
              { memo: "失败父游标", result: 1 },
              reminderApplicant,
            );
            for (const token of [reminderApplicant.token, admin]) {
              const current = await detail(failed.id, token);
              assert.equal(current.canRemind, false);
              assert.equal(
                current.remindUnavailableReason,
                "当前没有可催办的待办",
              );
              assert(
                current.execution.some((item) => item.status === "FAILED"),
              );
            }
            await sendReminder(failed, failed.version, 400);
            expectRecipients(failed, []);

            // 等待子流程与直接审批并存时仍能催直接支路；父事件不会误投递给子申请的审批人。
            child = await call(
              "/operations/workflows/" + child.id,
              admin,
              "PUT",
              {
                ...child,
                enabled: true,
                version: child.version,
              },
            );
            const mixedParent = await publish(
              spec(
                [
                  {
                    id: "fork",
                    name: "子流程与审批并行",
                    type: "PARALLEL",
                    next: "join",
                    branches: ["child", "right"],
                  },
                  { ...parentModel(child).nodes[0], next: "join" },
                  approval("right", b, "join"),
                  { id: "join", name: "汇合", type: "JOIN", next: "end" },
                ],
                { fields: [field, resultField] },
              ),
            );
            const mixed = await submit(
              mixedParent,
              { memo: "混合支路", result: 1 },
              reminderApplicant,
            );
            assert.equal(mixed.canRemind, true);
            await sendReminder(mixed, mixed.version);
            expectRecipients(mixed, [b.id]);
          },
        );

        await reminders.test(
          "临时委托只催实际受托人，来源人和未来审批人没有提醒",
          async () => {
            const owner = await user("rem_owner", true, {
              permissions: [
                "requests:view",
                "requests:approve",
                "requests:delegate",
                "users:view",
                "messages:view",
              ],
            });
            const definition = await publish(
              spec([
                approval("delegated", owner, "after"),
                approval("after", c, "end"),
              ]),
            );
            const localTime = (minutes) =>
              new Date(Date.now() + minutes * 60000)
                .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
                .replace(" ", "T");
            const delegation = await call(
              "/operations/delegations",
              owner.token,
              "POST",
              {
                targetId: d.id,
                startsAt: localTime(0),
                endsAt: localTime(120),
                definitionIds: [definition.id],
                reason: "催办真实委托接收人验收",
              },
            );
            made.delegations.push(delegation.id);
            const request = await submit(
              definition,
              { memo: "委托催办" },
              reminderApplicant,
            );
            assert.equal(
              (await detail(request.id, owner.token)).myTaskId,
              null,
            );
            assert((await detail(request.id, d.token)).myTaskId);
            await sendReminder(request, request.version);
            expectRecipients(request, [d.id]);
            await call(
              "/operations/delegations/" + delegation.id + "/revoke",
              owner.token,
              "POST",
              { version: delegation.version },
            );
          },
        );

        await reminders.test(
          "已办与取消支路不再催，重提以新轮待办重新开始冷却",
          async () => {
            const definition = await publish(
              spec([
                approval("gate", d, "fork"),
                {
                  id: "fork",
                  name: "并行",
                  type: "PARALLEL",
                  next: "join",
                  branches: ["left", "right"],
                },
                approval("left", a, "join"),
                approval("right", b, "join"),
                { id: "join", name: "汇合", type: "JOIN", next: "end" },
              ]),
            );
            const request = await submit(
              definition,
              { memo: "废弃支路催办" },
              reminderApplicant,
            );
            await decide(request.id, d);
            await decide(request.id, a);
            await decide(request.id, b, "RETURN", { targetNodeId: "gate" });
            const current = await detail(request.id, reminderApplicant.token);
            await sendReminder(request, current.version);
            expectRecipients(request, [d.id]);
            await decide(request.id, d, "RETURN");
            const returned = await detail(request.id, reminderApplicant.token);
            assert.equal(returned.canRemind, false);
            await sendReminder(request, returned.version, 400);
            const resubmitted = await call(
              "/operations/requests/" + request.id + "/submit",
              reminderApplicant.token,
              "POST",
              {
                version: returned.version,
                title: request.title,
                values: { memo: "重提后的新轮" },
              },
            );
            assert.equal(resubmitted.runNumber, request.runNumber + 1);
            assert.equal(resubmitted.canRemind, true);
            await sendReminder(request, current.version, 409);
            expectRecipients(request, [d.id]);
            await sendReminder(request, resubmitted.version);
            expectRecipients(request, [d.id, d.id]);
            assert.equal(
              Number(
                sql(
                  "SELECT COUNT(DISTINCT event_key) FROM ops_event WHERE request_id=" +
                    request.id +
                    " AND event_key LIKE 'reminder:%';",
                ).trim(),
              ),
              2,
            );
          },
        );
      },
    );

    await t.test("模拟展开全部支路和固定子路径，没有创建真实申请", async () => {
      const count = sql(
        `SELECT COUNT(*) FROM ops_flow_request WHERE applicant_id=${applicant.id};`,
      );
      const simulated = await call(
        "/operations/workflows/simulate",
        admin,
        "POST",
        {
          schema: parallel(),
          applicantId: applicant.id,
          values: { memo: "模拟" },
        },
      );
      assert(simulated.path.some((row) => row.id === "left"));
      assert(simulated.path.some((row) => row.id === "right"));
      assert.equal(simulated.path.filter((row) => row.id === "join").length, 1);
      const child = await publish(childModel(a)),
        nested = await call("/operations/workflows/simulate", admin, "POST", {
          schema: parentModel(child),
          applicantId: applicant.id,
          values: { memo: "模拟子流程", result: 1 },
        });
      assert.equal(nested.path[0].childPath[0].id, "review");
      assert.equal(
        sql(
          `SELECT COUNT(*) FROM ops_flow_request WHERE applicant_id=${applicant.id};`,
        ),
        count,
      );
    });
  } finally {
    // 子申请均由本次定义和申请人创建，先精确登记完整树，再锁事件并从叶子到根清理。
    const owned = made.users.length
      ? sql(
          `SELECT id FROM ops_flow_request WHERE definition_id IN (${ids(made.definitions)}) AND applicant_id IN (${ids(made.users)}) ORDER BY id DESC;`,
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
      : [];
    const req = ids(owned),
      defs = ids(made.definitions);
    sql(`START TRANSACTION; SELECT id FROM ops_event WHERE request_id IN (${req}) FOR UPDATE;
      DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${req});
      DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${req});
      DELETE FROM ops_notification WHERE target_type='APPROVAL' AND target_id IN (${req});
      DELETE FROM ops_event WHERE request_id IN (${req}); DELETE FROM ops_flow_task WHERE request_id IN (${req}); DELETE FROM ops_flow_decision WHERE request_id IN (${req});
      DELETE FROM ops_request_step WHERE request_id IN (${req}); DELETE FROM ops_request_file WHERE request_id IN (${req});
      ${owned.map((id) => `DELETE FROM ops_flow_request WHERE id=${id};`).join("\n")}
      DELETE FROM ops_flow_delegation WHERE id IN (${ids(made.delegations)}) AND owner_id IN (${ids(made.users)});
      DELETE FROM ops_flow_step WHERE definition_id IN (${defs}); DELETE FROM ops_flow_version WHERE definition_id IN (${defs}); DELETE FROM ops_flow_definition WHERE id IN (${defs}); COMMIT;`);
    for (const id of made.users)
      await call(`/system/users/${id}`, admin, "DELETE");
    for (const id of made.roles)
      await call(`/system/roles/${id}`, admin, "DELETE");
    if (dept)
      await call(`/system/entries/departments/${dept.id}`, admin, "DELETE");
    await call("/auth/logout", admin, "POST");
  }
});
