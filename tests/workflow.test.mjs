/**
 * 审批真实数据库集成测试：只在 verify-baseline 创建的隔离 Docker 项目运行。
 * 审批历史按业务规则不能删除，因此 finally 使用精确登记的测试 ID 清理隔离库，
 * 不在生产接口增加“测试后门”，也不会对日常数据库执行清理。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { purgeTestFiles } from "./support/files-cleanup.mjs";
import { spawnSync } from "node:child_process";
const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = "qa_w_" + Date.now().toString(36),
  password = "WorkflowQa_2026!";
const made = {
  users: [],
  roles: [],
  departments: [],
  definitions: [],
  requests: [],
  notices: [],
  files: [],
};
async function call(path, token, method = "GET", data, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    status,
    method + " " + path + ": " + JSON.stringify(body),
  );
  return body.data;
}
const login = async (user, secret = password) =>
  (await loginWithCaptcha(base, user, secret)).token;
const field = {
  id: "memo",
  label: "说明",
  type: "TEXT",
  required: true,
  width: 24,
  maxLength: 100,
};
const end = { id: "end", name: "结束", type: "END" };
const node = (ids, extra = {}) => ({
  id: "review",
  name: "审核",
  type: "APPROVAL",
  source: "USERS",
  assigneeIds: ids,
  mode: "ALL",
  next: "end",
  readable: ["memo"],
  writable: [],
  actions: ["APPROVE", "REJECT", "COMMENT", "TRANSFER", "ADD_SIGN"],
  ...extra,
});
const schema = (nodes) => ({
  fields: [field],
  nodes: [...nodes, end],
  startNodeId: nodes[0].id,
  applicantType: "ALL",
  applicantIds: [],
  allowSelfApproval: false,
  allowRepeatApproval: false,
  allowWithdraw: true,
});
const ids = (list) => {
  assert(list.every(Number.isSafeInteger));
  return list.length ? list.join(",") : "-1";
};
function sql(statement, administrator = false) {
  assert(isolated, "只允许独立验收项目");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "-f",
      "compose.verify.yaml",
      "exec",
      "-T",
      database,
      "sh",
      "-c",
      administrator
        ? 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --skip-column-names'
        : 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --skip-column-names',
    ],
    {
      input: statement,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test("审批运行、设计模型和内容审核闭环", { skip: !isolated }, async (t) => {
  const admin = await login("admin", process.env.ADMIN_PASSWORD);
  const user = async (label, permissions) => {
    const role = await call("/system/roles", admin, "POST", {
      name: label,
      code: prefix + "_" + label,
      enabled: true,
      permissions,
      dataScopes: { users: "ALL", notices: "SELF" },
    });
    made.roles.push(role.id);
    const account = await call("/system/users", admin, "POST", {
      username: prefix + "_" + label,
      nickname: label,
      password,
      enabled: true,
      roleIds: [role.id],
      departmentId: dept.id,
    });
    made.users.push(account.id);
    return { ...account, token: await login(account.username), role };
  };
  let dept;
  try {
    dept = await call("/system/entries/departments", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    made.departments.push(dept.id);
    const applicant = await user("app", [
      "requests:view",
      "requests:create",
      "messages:view",
      "notices:view",
      "notices:create",
      "notices:update",
      "files:view",
      "files:create",
    ]);
    const reviewPermissions = [
      "requests:view",
      "requests:approve",
      "messages:view",
      "users:view",
    ];
    const a = await user("a", reviewPermissions),
      b = await user("b", reviewPermissions),
      c = await user("c", reviewPermissions),
      outsider = await user("out", ["requests:view", "requests:create"]);
    const cat = (await call("/system/entries/approvalcategories", admin))
      .items[0];
    const create = async (spec, businessType = "GENERAL") => {
      let d = await call("/operations/workflows", admin, "POST", {
        name: prefix + " 流程 " + made.definitions.length,
        code: prefix + "_" + made.definitions.length,
        description: "审批集成验收",
        categoryId: cat.id,
        businessType,
        enabled: true,
        schema: spec,
      });
      made.definitions.push(d.id);
      d = await call(
        "/operations/workflows/" + d.id + "/publish",
        admin,
        "POST",
        { version: d.version },
      );
      return d;
    };
    const submit = async (d, extra = {}, token = applicant.token) => {
      const r = await call("/operations/requests", token, "POST", {
        definitionId: d.id,
        versionId: d.publishedVersionId,
        title: prefix + " 申请",
        values: { memo: "申请说明" },
        ...extra,
      });
      made.requests.push(r.id);
      return r;
    };
    const detail = (id, token = applicant.token) =>
      call("/operations/requests/" + id, token);
    const decide = async (id, who, action, extra = {}, status = 200) => {
      const latest = await detail(id, who.token);
      return call(
        "/operations/requests/" + id + "/decision",
        who.token,
        "POST",
        {
          version: latest.version,
          taskId: latest.myTaskId,
          action,
          comment: action === "REJECT" ? "请补充资料" : "处理记录",
          ...extra,
        },
        status,
      );
    };
    // OA 生命周期验收使用独立库、真实行锁和权限，不用模拟状态代替业务执行。
    const editApplication = async (
      id,
      values,
      submitAgain = false,
      token = applicant.token,
      status = 200,
    ) => {
      const latest = await detail(id, token);
      return call(
        `/operations/requests/${id}${submitAgain ? "/submit" : ""}`,
        token,
        submitAgain ? "POST" : "PUT",
        { version: latest.version, title: latest.title, values },
        status,
      );
    };
    await t.test(
      "草稿仅本人可见，部分保存与完整提交分开校验，日期区间和明细类型不能伪造",
      async () => {
        const spec = {
          ...schema([node([a.id])]),
          fields: [
            field,
            {
              id: "dates",
              label: "日期区间",
              type: "DATE_RANGE",
              required: true,
              width: 24,
            },
            {
              id: "items",
              label: "费用明细",
              type: "DETAILS",
              required: true,
              width: 24,
              maxRows: 2,
              columns: [
                { ...field, id: "item", label: "项目" },
                {
                  id: "cost",
                  label: "金额",
                  type: "MONEY",
                  required: true,
                  min: 0,
                  max: 1000,
                },
              ],
            },
          ],
        };
        const d = await create(spec);
        const draft = await call(
          "/operations/requests/drafts",
          applicant.token,
          "POST",
          {
            definitionId: d.id,
            versionId: d.publishedVersionId,
            title: prefix + " 草稿",
            values: {},
          },
        );
        made.requests.push(draft.id);
        assert.equal(draft.status, "DRAFT");
        assert.equal(draft.runNumber, 0);
        assert.equal(draft.tasks.length, 0);
        assert.equal(draft.submittedAt, null);
        await call(
          `/operations/requests/${draft.id}`,
          a.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${draft.id}`,
          admin,
          "GET",
          undefined,
          403,
        );
        assert.equal(
          (
            await call(
              `/operations/requests?box=all&keyword=${encodeURIComponent(draft.title)}`,
              admin,
            )
          ).total,
          0,
        );
        assert.equal(
          (
            await call(
              `/operations/requests?box=drafts&keyword=${encodeURIComponent(draft.title)}`,
              applicant.token,
            )
          ).total,
          1,
        );
        await editApplication(draft.id, { memo: "补充" });
        await editApplication(
          draft.id,
          { memo: "补充" },
          true,
          applicant.token,
          400,
        );
        const valid = {
          memo: "补充",
          dates: ["2026-10-01", "2026-10-03"],
          items: [{ item: "交通", cost: 30.25 }],
        };
        await editApplication(
          draft.id,
          { ...valid, dates: ["2026-10-03", "2026-10-01"] },
          true,
          applicant.token,
          400,
        );
        await editApplication(
          draft.id,
          { ...valid, items: [{ item: "非法", cost: 3, other: "伪造" }] },
          true,
          applicant.token,
          400,
        );
        await editApplication(
          draft.id,
          { ...valid, items: [{ item: "缺金额" }] },
          true,
          applicant.token,
          400,
        );
        await editApplication(
          draft.id,
          { ...valid, items: [{ item: "越界", cost: 1001 }] },
          true,
          applicant.token,
          400,
        );
        const submitted = await editApplication(draft.id, valid, true);
        assert.equal(submitted.status, "PENDING");
        assert.equal(submitted.runNumber, 1);
        assert.deepEqual(
          submitted.history.find((h) => h.action === "SUBMIT").submittedValues,
          valid,
        );
        await call(
          `/operations/requests/${draft.id}?version=${submitted.version}`,
          applicant.token,
          "DELETE",
          undefined,
          403,
        );
        const disposable = await call(
          "/operations/requests/drafts",
          applicant.token,
          "POST",
          {
            definitionId: d.id,
            versionId: d.publishedVersionId,
            title: "可删除草稿",
            values: {},
          },
        );
        await call(
          `/operations/requests/${disposable.id}?version=${disposable.version}`,
          outsider.token,
          "DELETE",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${disposable.id}?version=${disposable.version}`,
          applicant.token,
          "DELETE",
        );
        await call(
          `/operations/requests/${disposable.id}`,
          applicant.token,
          "GET",
          undefined,
          400,
        );
      },
    );
    await t.test(
      "顺签逐人激活，退回申请人重提隔离旧轮次，抄送只有阅读权限且快照裁剪隐藏字段",
      async () => {
        const d = await create({
          ...schema([
            node([a.id, b.id], {
              mode: "SERIAL",
              next: "copy",
              actions: ["APPROVE", "REJECT", "RETURN"],
            }),
            {
              id: "copy",
              name: "抄送",
              type: "COPY",
              source: "USERS",
              assigneeIds: [c.id],
              next: "end",
              readable: ["memo"],
              writable: [],
              actions: [],
            },
          ]),
          fields: [field, { ...field, id: "private", label: "保密" }],
        });
        const r = await submit(d, {
          values: { memo: "第一轮", private: "秘密一" },
        });
        const oldTask = r.tasks.find((task) => task.assigneeId === a.id).id;
        assert.equal(
          r.tasks.find((task) => task.assigneeId === b.id).status,
          "WAITING",
        );
        await call(
          `/operations/requests/${r.id}`,
          b.token,
          "GET",
          undefined,
          403,
        );
        await call(
          `/operations/requests/${r.id}`,
          c.token,
          "GET",
          undefined,
          403,
        );
        await decide(r.id, a, "APPROVE");
        assert((await detail(r.id, b.token)).myTaskId);
        await decide(r.id, b, "RETURN");
        const returned = await detail(r.id);
        assert.equal(returned.status, "RETURNED");
        assert(returned.canEdit);
        assert(
          !returned.tasks.some((task) =>
            ["PENDING", "WAITING"].includes(task.status),
          ),
        );
        await editApplication(
          r.id,
          { memo: "第二轮", private: "秘密二" },
          false,
          b.token,
          403,
        );
        await editApplication(r.id, { memo: "第二轮", private: "秘密二" });
        const next = await editApplication(
          r.id,
          { memo: "第二轮", private: "秘密二" },
          true,
        );
        assert.equal(next.runNumber, 2);
        await call(
          `/operations/requests/${r.id}/decision`,
          a.token,
          "POST",
          { version: next.version, taskId: oldTask, action: "APPROVE" },
          403,
        );
        await decide(r.id, a, "APPROVE");
        await decide(r.id, b, "APPROVE");
        const copy = await detail(r.id, c.token);
        assert.equal(copy.status, "APPROVED");
        assert.equal(copy.unreadCopies, 1);
        assert.deepEqual(
          copy.fields.map((f) => f.id),
          ["memo"],
        );
        assert.equal(copy.values.private, undefined);
        assert(
          copy.history.every((h) => h.submittedValues.private === undefined),
        );
        assert.equal(copy.actions.length, 0);
        const mine = await call(
          `/operations/requests?box=copies&keyword=${encodeURIComponent(r.title)}`,
          c.token,
        );
        assert.equal(mine.total, 1);
        await call(`/operations/requests/${r.id}/copies/read`, c.token, "POST");
        const read = await detail(r.id, c.token);
        assert.equal(read.unreadCopies, 0);
        assert.equal(read.version, copy.version);
        const own = await detail(r.id);
        assert.equal(
          own.history.filter((h) => ["SUBMIT", "RESUBMIT"].includes(h.action))
            .length,
          2,
        );
        assert.equal(
          own.history.find((h) => h.action === "SUBMIT").submittedValues.memo,
          "第一轮",
        );
      },
    );
    await t.test(
      "退回实际已办节点可重复办理，旧会签与退回后的旧待办不能驱动新批次",
      async () => {
        const d = await create(
          schema([
            node([a.id, b.id], {
              mode: "ANY",
              next: "second",
              actions: ["APPROVE", "REJECT", "RETURN"],
            }),
            node([c.id], {
              id: "second",
              name: "复核",
              actions: ["APPROVE", "REJECT", "RETURN"],
            }),
          ]),
        );
        const r = await submit(d);
        await decide(r.id, a, "APPROVE");
        const before = await detail(r.id, c.token);
        assert.deepEqual(before.returnTargets, [
          { id: "review", name: "审核" },
        ]);
        await decide(r.id, c, "RETURN", { targetNodeId: "notVisited" }, 400);
        await decide(r.id, c, "RETURN", { targetNodeId: "review" });
        const renewed = await detail(r.id);
        assert.equal(renewed.currentNodeName, "审核");
        assert.equal(renewed.runNumber, 1);
        const batch = renewed.tasks.filter((task) => task.status === "PENDING");
        assert.equal(batch.length, 2);
        assert(
          batch.every(
            (task) =>
              task.nodeVisit >
              before.tasks.find((task) => task.id === before.myTaskId)
                .nodeVisit,
          ),
        );
        await decide(r.id, b, "APPROVE");
        assert.equal((await detail(r.id)).currentNodeName, "复核");
        await decide(r.id, c, "RETURN", { targetNodeId: "review" });
        await decide(r.id, a, "APPROVE");
        await decide(r.id, c, "APPROVE");
        assert.equal((await detail(r.id)).status, "APPROVED");
        assert.equal(
          (await detail(r.id)).history.filter((h) => h.action === "RETURN")
            .length,
          2,
        );
      },
    );
    await t.test(
      "撤回可以重提，管理员终止不能代替审批，终态不可复活或删除",
      async () => {
        const d = await create(
          schema([node([a.id], { actions: ["APPROVE", "REJECT", "RETURN"] })]),
        );
        const r = await submit(d);
        await decide(r.id, applicant, "WITHDRAW");
        assert((await detail(r.id)).canEdit);
        await editApplication(r.id, { memo: "撤回修改" }, true);
        const latest = await detail(r.id);
        assert.equal(latest.runNumber, 2);
        await call(
          `/operations/requests/${r.id}/decision`,
          applicant.token,
          "POST",
          { version: latest.version, action: "TERMINATE", comment: "伪造" },
          403,
        );
        await call(
          `/operations/requests/${r.id}/decision`,
          admin,
          "POST",
          { version: latest.version, action: "TERMINATE" },
          400,
        );
        await call(`/operations/requests/${r.id}/decision`, admin, "POST", {
          version: latest.version,
          action: "TERMINATE",
          comment: "业务取消",
        });
        assert.equal((await detail(r.id)).status, "CANCELLED");
        await editApplication(
          r.id,
          { memo: "试图复活" },
          true,
          applicant.token,
          403,
        );
        await decide(r.id, a, "APPROVE", {}, 400);
      },
    );
    await t.test(
      "审批与退回并发只有一个成功，不产生两个节点批次或重复结果",
      async () => {
        const d = await create(
          schema([
            node([a.id, b.id], {
              mode: "ANY",
              actions: ["APPROVE", "REJECT", "RETURN"],
            }),
          ]),
        );
        const r = await submit(d),
          da = await detail(r.id, a.token),
          db = await detail(r.id, b.token);
        const responses = await Promise.all(
          [
            [a, da, "APPROVE"],
            [b, db, "RETURN"],
          ].map(async ([who, view, action]) =>
            fetch(base + `/operations/requests/${r.id}/decision`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + who.token,
              },
              body: JSON.stringify({
                version: view.version,
                taskId: view.myTaskId,
                action,
                comment: "并发验收",
              }),
            }),
          ),
        );
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [200, 409],
        );
        const latest = await detail(r.id);
        assert(["APPROVED", "RETURNED"].includes(latest.status));
        assert.equal(
          latest.history.filter((h) => ["APPROVE", "RETURN"].includes(h.action))
            .length,
          1,
        );
        assert(
          !latest.tasks.some((task) =>
            ["PENDING", "WAITING"].includes(task.status),
          ),
        );
      },
    );
    await t.test(
      "互斥条件分支允许同一审批人，金额等值不受小数表示形式影响",
      async () => {
        const d = await create({
          ...schema([
            {
              id: "choice",
              name: "金额分流",
              type: "CONDITION",
              next: "review",
              conditions: [
                {
                  field: "amount",
                  operator: "EQ",
                  value: "0.00",
                  next: "alternative",
                },
              ],
            },
            node([a.id]),
            node([a.id], { id: "alternative", name: "零金额审核" }),
          ]),
          fields: [
            field,
            { id: "amount", label: "金额", type: "MONEY", required: true },
          ],
          startNodeId: "choice",
        });
        const r = await submit(d, { values: { memo: "分支", amount: 0 } });
        assert.equal(r.currentNodeName, "零金额审核");
        await decide(r.id, a, "APPROVE");
        assert.equal((await detail(r.id)).status, "APPROVED");
      },
    );
    await t.test(
      "个人待办按当前节点分派，通知仅收件人可读，阅读不等于处理且结果通知申请人",
      async () => {
        const title = prefix + " 首页提醒";
        const d = await create(
          schema([
            node([a.id], { next: "second" }),
            node([b.id], { id: "second", name: "复核" }),
          ]),
        );
        const r = await submit(d, { title });
        const todo = (who) =>
          call(
            "/operations/requests?box=todo&page=1&size=3&keyword=" +
              encodeURIComponent(title),
            who.token,
          );
        const unread = (who) =>
          call(
            "/operations/messages?read=false&page=1&size=3&keyword=" +
              encodeURIComponent(title),
            who.token,
          );
        const waitDelivery = async () => {
          const deadline = Date.now() + 9000;
          do {
            const events = await call(
              "/operations/requests/" + r.id + "/events",
              admin,
            );
            if (events.length && events.every((e) => e.status === "DELIVERED"))
              return;
            await new Promise((resolve) => setTimeout(resolve, 300));
          } while (Date.now() < deadline);
          assert.fail("审批通知未在预期时间内投递");
        };
        assert.equal((await todo(a)).total, 1);
        assert.equal(
          (await todo(b)).total,
          0,
          "后续节点未到达时不能提前生成待办",
        );
        assert.equal((await todo(c)).total, 0, "无关审批人不应看到他人待办");
        await call(
          "/operations/requests?box=todo",
          outsider.token,
          "GET",
          undefined,
          403,
        );
        await call(
          "/operations/messages/unread",
          outsider.token,
          "GET",
          undefined,
          403,
        );
        await waitDelivery();
        const pending = await unread(a);
        assert.equal(pending.total, 1);
        assert.equal((await unread(b)).total, 0);
        assert.equal((await unread(c)).total, 0);
        const deliveryId = pending.items[0].id;
        const message = await call(
          "/operations/messages/" + deliveryId,
          a.token,
        );
        assert.equal(message.targetType, "APPROVAL");
        assert.equal(message.targetId, r.id);
        await call(
          "/operations/messages/" + deliveryId,
          b.token,
          "GET",
          undefined,
          403,
        );
        await call(
          "/operations/messages/" + deliveryId + "/read",
          b.token,
          "POST",
          undefined,
          403,
        );
        const count = await call("/operations/messages/unread", a.token);
        await call(
          "/operations/messages/" + deliveryId + "/read",
          a.token,
          "POST",
        );
        assert.equal(
          await call("/operations/messages/unread", a.token),
          count - 1,
        );
        assert.equal((await unread(a)).total, 0);
        assert.equal((await todo(a)).total, 1, "读通知不能清除仍需处理的审批");
        await decide(r.id, a, "APPROVE");
        assert.equal((await todo(a)).total, 0);
        assert.equal((await todo(b)).total, 1);
        await waitDelivery();
        assert.equal((await unread(b)).total, 1);
        await decide(r.id, b, "APPROVE");
        assert.equal((await todo(b)).total, 0);
        await waitDelivery();
        const result = await unread(applicant);
        assert.equal(result.total, 1);
        assert.match(result.items[0].summary, /已通过/);
      },
    );
    await t.test(
      "发布校验拒绝循环、不可达节点、绕过审核的分支及无效字段",
      async () => {
        const normal = schema([node([a.id])]);
        for (const invalid of [
          { ...normal, nodes: [node([a.id], { next: "review" }), end] },
          { ...normal, nodes: [node([a.id]), { ...end, id: "orphan" }, end] },
          { ...normal, nodes: [node([a.id], { writable: ["secret"] }), end] },
          {
            ...normal,
            nodes: [
              {
                id: "branch",
                name: "条件",
                type: "CONDITION",
                next: "end",
                conditions: [
                  { field: "memo", operator: "EQ", value: "x", next: "review" },
                ],
              },
              node([a.id]),
              end,
            ],
            startNodeId: "branch",
          },
        ])
          await call(
            "/operations/workflows/simulate",
            admin,
            "POST",
            {
              schema: invalid,
              applicantId: applicant.id,
              values: { memo: "x" },
            },
            400,
          );
        const before = (await call("/operations/requests?box=all", admin))
          .total;
        const result = await call(
          "/operations/workflows/simulate",
          admin,
          "POST",
          { schema: normal, applicantId: applicant.id, values: { memo: "x" } },
        );
        assert.deepEqual(
          result.path.map((n) => n.type),
          ["APPROVAL", "END"],
        );
        assert.equal(
          (await call("/operations/requests?box=all", admin)).total,
          before,
        );
      },
    );
    await t.test(
      "会签并发不覆盖、不可读字段隐藏、不可写字段拒绝、历史完整",
      async () => {
        const s = {
          ...schema([node([a.id, b.id], { writable: ["memo"] })]),
          fields: [
            field,
            {
              id: "privateNote",
              label: "仅申请人备注",
              type: "TEXT",
              width: 24,
            },
          ],
        };
        const d = await create(s);
        const r = await submit(d, {
          values: { memo: "原说明", privateNote: "仅申请人可读" },
        });
        await detail(r.id, outsider.token).then(
          () => assert.fail("不应读到申请"),
          () => {},
        );
        await call(
          "/operations/requests/" + r.id,
          outsider.token,
          "GET",
          undefined,
          403,
        );
        const av = await detail(r.id, a.token),
          bv = await detail(r.id, b.token);
        assert.equal(av.values.privateNote, undefined);
        assert.equal(
          av.fields.some((f) => f.id === "privateNote"),
          false,
        );
        await call(
          "/operations/requests/" + r.id + "/decision",
          a.token,
          "POST",
          {
            version: av.version,
            taskId: av.myTaskId,
            action: "APPROVE",
            values: { privateNote: "越权" },
          },
          403,
        );
        const send = (who, v) =>
          fetch(base + "/operations/requests/" + r.id + "/decision", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + who.token,
            },
            body: JSON.stringify({
              version: v.version,
              taskId: v.myTaskId,
              action: "APPROVE",
            }),
          });
        const responses = await Promise.all([send(a, av), send(b, bv)]);
        assert.deepEqual(responses.map((x) => x.status).sort(), [200, 409]);
        for (const who of [a, b])
          if ((await detail(r.id, who.token)).myTaskId)
            await decide(r.id, who, "APPROVE");
        const done = await detail(r.id);
        assert.equal(done.status, "APPROVED");
        assert.equal(
          done.history.filter((h) => h.action === "APPROVE").length,
          2,
        );
        await call(
          "/operations/requests/" + r.id + "/decision",
          a.token,
          "POST",
          { version: av.version, taskId: av.myTaskId, action: "APPROVE" },
          409,
        );
        await call(
          "/operations/workflows/" + d.id,
          admin,
          "DELETE",
          undefined,
          400,
        );
      },
    );
    await t.test(
      "或签、加签与转交保持原处理人状态，通知按事件唯一投递",
      async () => {
        const d = await create(schema([node([a.id, b.id], { mode: "ANY" })]));
        const r = await submit(d);
        await decide(r.id, a, "ADD_SIGN", { targetUserId: c.id });
        await decide(r.id, c, "APPROVE");
        assert.equal(
          (await detail(r.id)).status,
          "PENDING",
          "加签完成不能代替原节点审批",
        );
        await decide(r.id, a, "APPROVE");
        assert.equal((await detail(r.id)).status, "APPROVED");
        const second = await submit(d);
        await decide(second.id, a, "TRANSFER", { targetUserId: c.id });
        const old = await detail(second.id, a.token);
        assert.equal(old.myTaskId, null);
        await call(
          "/operations/requests/" + second.id + "/decision",
          a.token,
          "POST",
          {
            version: old.version,
            taskId: old.tasks.find((t) => t.assigneeId === a.id).id,
            action: "APPROVE",
          },
          403,
        );
        await decide(second.id, c, "APPROVE");
        assert.equal((await detail(second.id)).status, "APPROVED");
        const deadline = Date.now() + 9000;
        while (Date.now() < deadline) {
          const events = await call(
            "/operations/requests/" + second.id + "/events",
            admin,
          );
          if (events.every((e) => e.status === "DELIVERED")) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const events = await call(
          "/operations/requests/" + second.id + "/events",
          admin,
        );
        assert(
          events.length > 0 && events.every((e) => e.status === "DELIVERED"),
        );
        await call(
          "/operations/requests/" + second.id + "/retry-notifications",
          admin,
          "POST",
        );
        const counts = sql(
          "SELECT COUNT(*),COUNT(DISTINCT event_key) FROM ops_notification WHERE target_type='APPROVAL' AND target_id=" +
            second.id +
            ";",
        )
          .trim()
          .split("\t");
        assert.equal(counts[0], counts[1]);
        const inbox = await call(
          "/operations/messages?keyword=" + prefix,
          c.token,
        );
        assert(inbox.total >= 2);
      },
    );
    await t.test(
      "已发布模型不可原地覆盖，旧申请继续旧版本；发起范围与自审规则生效",
      async () => {
        let d = await create(schema([node([a.id])]));
        const r = await submit(d);
        const firstVersion = d.publishedVersionId;
        d = await call("/operations/workflows/" + d.id, admin, "PUT", {
          ...d,
          schema: schema([node([b.id])]),
        });
        assert.equal(d.publishedVersionId, firstVersion);
        d = await call(
          "/operations/workflows/" + d.id + "/publish",
          admin,
          "POST",
          { version: d.version },
        );
        assert.notEqual(d.publishedVersionId, firstVersion);
        await call(
          "/operations/requests",
          applicant.token,
          "POST",
          {
            definitionId: d.id,
            versionId: firstVersion,
            title: "过期模型",
            values: { memo: "x" },
          },
          409,
        );
        await decide(r.id, a, "APPROVE");
        assert.equal((await detail(r.id)).status, "APPROVED");
        const latest = await submit(d);
        assert((await detail(latest.id, b.token)).myTaskId);
        await decide(latest.id, applicant, "WITHDRAW");
        const restricted = await create({
          ...schema([node([a.id])]),
          applicantType: "USERS",
          applicantIds: [applicant.id],
        });
        await call(
          "/operations/requests",
          outsider.token,
          "POST",
          {
            definitionId: restricted.id,
            versionId: restricted.publishedVersionId,
            title: "越权发起",
            values: { memo: "x" },
          },
          403,
        );
        const self = await create(schema([node([applicant.id])])).catch(
          () => null,
        );
        assert.equal(self, null, "无审批权限的人员不能被发布为审批人");
      },
    );
    await t.test(
      "处理时重新检查审批权限，驳回与撤回后不能继续处理",
      async () => {
        const d = await create(schema([node([a.id])]));
        const r = await submit(d);
        let role = await call("/system/roles/" + a.role.id, admin, "PUT", {
          ...a.role,
          permissions: a.role.permissions.filter(
            (p) => p !== "requests:approve",
          ),
        });
        await decide(r.id, a, "APPROVE", {}, 403);
        role = await call("/system/roles/" + a.role.id, admin, "PUT", {
          ...role,
          permissions: reviewPermissions,
        });
        a.role = role;
        await decide(r.id, a, "REJECT");
        assert.equal((await detail(r.id)).status, "REJECTED");
        const next = await submit(d);
        await decide(next.id, applicant, "WITHDRAW");
        await decide(next.id, a, "APPROVE", {}, 400);
        assert.equal((await detail(next.id)).status, "WITHDRAWN");
      },
    );
    await t.test("条件路径、人员角色及部门负责人解析可运行", async () => {
      dept = await call(
        "/system/entries/departments/" + dept.id,
        admin,
        "PUT",
        { ...dept, leaderId: c.id },
      );
      const s = {
        ...schema([
          {
            id: "branch",
            name: "金额条件",
            type: "CONDITION",
            next: "small",
            conditions: [
              { field: "amount", operator: "GT", value: "100", next: "large" },
            ],
          },
          node([a.role.id], { id: "small", name: "普通审核", source: "ROLES" }),
          node([], {
            id: "large",
            name: "部门负责人",
            source: "DEPARTMENT_LEADER",
          }),
        ]),
        fields: [
          field,
          {
            id: "amount",
            label: "金额",
            type: "MONEY",
            required: true,
            width: 12,
            min: 0,
            max: 10000,
          },
        ],
      };
      const d = await create(s);
      const large = await submit(d, {
        values: { memo: "金额申请", amount: 200 },
      });
      assert((await detail(large.id, c.token)).myTaskId);
      await call(
        "/operations/requests/" + large.id,
        a.token,
        "GET",
        undefined,
        403,
      );
      await decide(large.id, c, "APPROVE");
      const small = await submit(d, {
        values: { memo: "金额申请", amount: 20 },
      });
      assert((await detail(small.id, a.token)).myTaskId);
      await decide(small.id, a, "APPROVE");
    });
    await t.test(
      "字段修正保留提交快照与差异，附件严格遵循字段可读范围",
      async () => {
        const body = new FormData();
        body.set(
          "file",
          new Blob(["审批附件专用内容"], { type: "text/plain" }),
          "approval-proof.txt",
        );
        const upload = await fetch(base + "/operations/files", {
          method: "POST",
          headers: { Authorization: "Bearer " + applicant.token },
          body,
        });
        assert.equal(upload.status, 200);
        const file = (await upload.json()).data;
        made.files.push(file.id);
        const s = {
          ...schema([node([a.id], { writable: ["memo"] })]),
          fields: [
            field,
            { id: "proof", label: "附件", type: "FILES", width: 24 },
          ],
        };
        const d = await create(s),
          r = await submit(d, {
            values: { memo: "原始说明", proof: [file.id] },
          });
        const read = async (token) =>
          fetch(base + "/operations/requests/" + r.id + "/files/" + file.id, {
            headers: { Authorization: "Bearer " + token },
          });
        assert.equal((await read(a.token)).status, 403);
        const own = await read(applicant.token);
        assert.equal(own.status, 200);
        assert.equal(await own.text(), "审批附件专用内容");
        const done = await decide(r.id, a, "APPROVE", {
          values: { memo: "核对后说明" },
        });
        assert.equal(done.values.memo, "核对后说明");
        assert.deepEqual(
          done.history.find((h) => h.action === "APPROVE").changes,
          { memo: { before: "原始说明", after: "核对后说明" } },
        );
        assert.equal(
          JSON.parse(
            sql(
              "SELECT submitted_form_data FROM ops_flow_request WHERE id=" +
                r.id +
                ";",
            ),
          ).memo,
          "原始说明",
        );
        assert.equal(done.values.proof, undefined);
        assert.equal(done.files.length, 0);
        await call(
          "/operations/files/" + file.id,
          admin,
          "DELETE",
          undefined,
          400,
        );
      },
    );
    await t.test("下一节点权限撤回时当前决定、历史与通知一起回滚", async () => {
      const d = await create(
        schema([
          node([a.id], { next: "second" }),
          node([b.id], { id: "second", name: "复核" }),
        ]),
      );
      const r = await submit(d);
      const before = await detail(r.id, a.token);
      let role = await call("/system/roles/" + b.role.id, admin, "PUT", {
        ...b.role,
        permissions: reviewPermissions.filter((p) => p !== "requests:approve"),
      });
      await decide(r.id, a, "APPROVE", {}, 400);
      const after = await detail(r.id, a.token);
      assert.equal(after.version, before.version);
      assert.equal(after.myTaskId, before.myTaskId);
      assert.equal(after.history.length, before.history.length);
      assert.equal(
        (await call("/operations/requests/" + r.id + "/events", admin)).length,
        1,
      );
      b.role = await call("/system/roles/" + b.role.id, admin, "PUT", {
        ...role,
        permissions: reviewPermissions,
      });
      await decide(r.id, a, "APPROVE");
      await decide(r.id, b, "APPROVE");
      const self = await create(schema([node([a.id])]));
      let ar = await call("/system/roles/" + a.role.id, admin, "PUT", {
        ...a.role,
        permissions: [...reviewPermissions, "requests:create"],
      });
      await call(
        "/operations/requests",
        a.token,
        "POST",
        {
          definitionId: self.id,
          versionId: self.publishedVersionId,
          title: "禁止自审",
          values: { memo: "x" },
        },
        400,
      );
      a.role = await call("/system/roles/" + a.role.id, admin, "PUT", {
        ...ar,
        permissions: reviewPermissions,
      });
    });
    await t.test(
      "事务事件失败后能重试，回滚半成品且不重复生成消息",
      async () => {
        const d = await create(schema([node([a.id])])),
          r = await submit(d);
        const trigger = prefix + "_delivery_" + r.id;
        assert.match(trigger, /^[a-zA-Z0-9_]{1,64}$/);
        // 800字符正文现在是合法输入，不能再冒充失败；在保存投递时制造真实数据库错误，验证已写通知完整回滚。
        // 触发器仅匹配本次隔离申请，使用容器内管理账号创建并在 finally 精确删除，生产接口没有故障入口。
        sql(
          `DELIMITER $$
CREATE TRIGGER ${trigger} BEFORE INSERT ON ops_delivery FOR EACH ROW
BEGIN
  IF EXISTS(SELECT 1 FROM ops_notification WHERE id=NEW.notification_id AND target_type='APPROVAL' AND target_id=${r.id}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated workflow delivery failure';
  END IF;
END$$
DELIMITER ;`,
          true,
        );
        let events;
        try {
          sql(
            "START TRANSACTION;SELECT id FROM ops_event WHERE request_id=" +
              r.id +
              " FOR UPDATE;DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id=" +
              r.id +
              ";DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id=" +
              r.id +
              ";DELETE FROM ops_notification WHERE target_type='APPROVAL' AND target_id=" +
              r.id +
              ";UPDATE ops_event SET body='通知事务回滚验收',attempts=0,status='PENDING',next_attempt_at=NOW() WHERE request_id=" +
              r.id +
              ";COMMIT;",
          );
          const deadline = Date.now() + 12000;
          do {
            events = await call(
              "/operations/requests/" + r.id + "/events",
              admin,
            );
            if (events[0].attempts > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 300));
          } while (Date.now() < deadline);
          assert(events[0].attempts > 0);
          assert.equal(events[0].status, "PENDING");
          assert.equal(
            sql(
              "SELECT COUNT(*) FROM ops_notification WHERE target_type='APPROVAL' AND target_id=" +
                r.id +
                ";",
            ).trim(),
            "0",
          );
        } finally {
          sql("DROP TRIGGER IF EXISTS " + trigger + ";", true);
        }
        sql(
          "UPDATE ops_event SET body='通知重试验收' WHERE request_id=" +
            r.id +
            ";",
        );
        await call(
          "/operations/requests/" + r.id + "/retry-notifications",
          admin,
          "POST",
        );
        const retryDeadline = Date.now() + 9000;
        do {
          events = await call(
            "/operations/requests/" + r.id + "/events",
            admin,
          );
          if (events[0].status === "DELIVERED") break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        } while (Date.now() < retryDeadline);
        assert.equal(events[0].status, "DELIVERED");
        await call(
          "/operations/requests/" + r.id + "/retry-notifications",
          admin,
          "POST",
        );
        assert.equal(
          sql(
            "SELECT COUNT(*) FROM ops_notification WHERE target_type='APPROVAL' AND target_id=" +
              r.id +
              ";",
          ).trim(),
          "1",
        );
        await decide(r.id, applicant, "WITHDRAW");
      },
    );
    await t.test(
      "内容审批绑定送审快照，修改后不能继承旧审核；前台发布仍单独鉴权",
      async () => {
        const category = (await call("/public/taxonomy")).categories[0];
        const input = {
          title: prefix + " 内容",
          categoryId: category.id,
          content: "送审版本一",
          requiresApproval: true,
        };
        let content = await call(
          "/content/notices",
          applicant.token,
          "POST",
          input,
        );
        made.notices.push(content.id);
        const d = await create(schema([node([a.id])]), "CONTENT");
        const submitContent = async () =>
          submit(d, {
            businessId: content.id,
            businessRevisionId: content.revisionId,
            businessVersion: content.version,
          });
        // 内容草稿必须在读取送审快照前鉴权，并且不占用内容审核状态。
        const draftPayload = {
          definitionId: d.id,
          versionId: d.publishedVersionId,
          title: "内容审核草稿",
          values: {},
          businessId: content.id,
          businessRevisionId: content.revisionId,
          businessVersion: content.version,
        };
        await call(
          "/operations/requests/drafts",
          outsider.token,
          "POST",
          draftPayload,
          403,
        );
        const draft = await call(
          "/operations/requests/drafts",
          applicant.token,
          "POST",
          draftPayload,
        );
        made.requests.push(draft.id);
        assert.equal(draft.status, "DRAFT");
        assert.equal(draft.tasks.length, 0);
        const afterDraft = await call(
          "/content/notices/" + content.id,
          applicant.token,
        );
        assert.equal(afterDraft.version, content.version);
        assert.equal(afterDraft.status, content.status);
        // 草稿创建时的权限不是永久授权；撤销业务编辑权限后读、保存、提交都拒绝。
        let applicantRole = applicant.role;
        const originalPermissions = applicantRole.permissions;
        applicantRole = await call(
          "/system/roles/" + applicant.role.id,
          admin,
          "PUT",
          {
            ...applicantRole,
            permissions: originalPermissions.filter(
              (p) => p !== "notices:update",
            ),
          },
        );
        await call(
          `/operations/requests/${draft.id}`,
          applicant.token,
          "GET",
          undefined,
          403,
        );
        for (const [suffix, method] of [
          ["", "PUT"],
          ["/submit", "POST"],
        ])
          await call(
            `/operations/requests/${draft.id}${suffix}`,
            applicant.token,
            method,
            {
              version: draft.version,
              title: draft.title,
              values: { memo: "权限已撤销" },
              businessVersion: content.version,
            },
            403,
          );
        applicant.role = await call(
          "/system/roles/" + applicant.role.id,
          admin,
          "PUT",
          { ...applicantRole, permissions: originalPermissions },
        );
        assert.equal(
          (await detail(draft.id)).version,
          draft.version,
          "拒绝的保存必须完整回滚",
        );
        const first = await submitContent();
        await call(
          "/content/notices/" + content.id + "/publish",
          admin,
          "POST",
          {
            version: (await call("/content/notices/" + content.id, admin))
              .version,
            revisionId: content.revisionId,
          },
          400,
        );
        const snapshot = await detail(first.id, a.token);
        assert.equal(snapshot.business.content, "<p>送审版本一</p>");
        await call(
          "/content/notices/" + content.id,
          a.token,
          "GET",
          undefined,
          403,
        );
        let latest = await call(
          "/content/notices/" + content.id,
          applicant.token,
        );
        content = await call(
          "/content/notices/" + content.id,
          applicant.token,
          "PUT",
          { ...input, content: "新版本二", version: latest.version },
        );
        assert.equal(
          (await detail(first.id, a.token)).business.currentRevision,
          false,
        );
        await decide(first.id, a, "APPROVE");
        content = await call("/content/notices/" + content.id, applicant.token);
        await call(
          "/content/notices/" + content.id + "/publish",
          admin,
          "POST",
          { version: content.version, revisionId: content.revisionId },
          400,
        );
        const second = await submitContent();
        await decide(second.id, a, "REJECT");
        content = await call("/content/notices/" + content.id, applicant.token);
        const third = await submitContent();
        await decide(third.id, applicant, "WITHDRAW");
        content = await call("/content/notices/" + content.id, applicant.token);
        const fourth = await submitContent();
        await decide(fourth.id, a, "APPROVE");
        content = await call("/content/notices/" + content.id, applicant.token);
        assert.equal(content.status, "APPROVED");
        await call(
          "/content/notices/" + content.id + "/publish",
          applicant.token,
          "POST",
          { version: content.version, revisionId: content.revisionId },
          403,
        );
        content = await call(
          "/content/notices/" + content.id + "/publish",
          admin,
          "POST",
          { version: content.version, revisionId: content.revisionId },
        );
        assert.equal(
          (await call("/public/articles/" + content.id)).content,
          "<p>新版本二</p>",
        );
      },
    );
  } finally {
    // 明确锁定本次事件，再删除它们生成的站内投递；不会借助永久删除接口放宽业务审计规则。
    const req = ids(made.requests),
      defs = ids(made.definitions);
    sql(
      "START TRANSACTION; SELECT id FROM ops_event WHERE request_id IN (" +
        req +
        ") FOR UPDATE;" +
        "DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (" +
        req +
        ");" +
        "DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (" +
        req +
        ");" +
        "DELETE n FROM ops_notification n WHERE n.target_type='APPROVAL' AND n.target_id IN (" +
        req +
        ");" +
        "DELETE FROM ops_event WHERE request_id IN (" +
        req +
        ");DELETE FROM ops_flow_task WHERE request_id IN (" +
        req +
        ");DELETE FROM ops_flow_decision WHERE request_id IN (" +
        req +
        ");DELETE FROM ops_request_step WHERE request_id IN (" +
        req +
        ");DELETE FROM ops_request_file WHERE request_id IN (" +
        req +
        ");DELETE FROM ops_flow_request WHERE id IN (" +
        req +
        ");" +
        "DELETE FROM ops_flow_step WHERE definition_id IN (" +
        defs +
        ");DELETE FROM ops_flow_version WHERE definition_id IN (" +
        defs +
        ");DELETE FROM ops_flow_definition WHERE id IN (" +
        defs +
        ");COMMIT;",
    );
    for (const id of made.notices) {
      await call("/content/notices/" + id, admin, "DELETE");
      await call("/content/notices/" + id + "/purge", admin, "DELETE");
    }
    await purgeTestFiles(base, admin, made.files);
    if (dept?.leaderId)
      await call("/system/entries/departments/" + dept.id, admin, "PUT", {
        ...dept,
        leaderId: null,
      });
    for (const id of made.users)
      await call("/system/users/" + id, admin, "DELETE");
    for (const id of made.roles)
      await call("/system/roles/" + id, admin, "DELETE");
    for (const id of made.departments)
      await call("/system/entries/departments/" + id, admin, "DELETE");
    await call("/auth/logout", admin, "POST");
  }
});
