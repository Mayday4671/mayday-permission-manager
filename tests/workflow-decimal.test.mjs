/**
 * OA 十进制真实闭环。先由独立 JSDOM 中的正常 Ant 控件产出精确填写与上下限，再把同一产物
 * 交给 Java 保存、发布、模拟、发起、退回重提及父子映射；只操作白名单隔离库的专属实体。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { isolatedSql } from "./support/isolated-compose.mjs";

const base = process.env.API_BASE,
  project = process.env.API_TEST_COMPOSE_PROJECT,
  database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = "qa_dec_" + Date.now().toString(36),
  password = "DecimalQa_2026!";
const made = { users: [], roles: [], definitions: [] };
const ids = (list) => {
  assert(list.every(Number.isSafeInteger));
  return list.length ? list.join(",") : "-1";
};
function sql(statement) {
  assert(isolated, "只允许白名单隔离库");
  return isolatedSql(statement, { maxBuffer: 3e6 });
}

/** 可发送旧数字 literal 验证属性级解码；状态诊断不回显令牌、口令或私稿。 */
async function call(
  path,
  token,
  method = "GET",
  data,
  expected = 200,
  raw = false,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : raw ? data : JSON.stringify(data),
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${result.message ?? ""}`,
  );
  return result.data;
}
const end = { id: "end", name: "结束", type: "END" };
const approval = (id, who, next, fields, writable = []) => ({
  id,
  name: id,
  type: "APPROVAL",
  source: "USERS",
  assigneeIds: [who.id],
  mode: "ALL",
  next,
  readable: fields.map((field) => field.id),
  writable,
  actions: ["APPROVE", "REJECT", "RETURN", "COMMENT"],
});
const schema = (fields, nodes) => ({
  fields,
  nodes: [...nodes, end],
  startNodeId: nodes[0].id,
  applicantType: "ALL",
  applicantIds: [],
  allowSelfApproval: false,
  allowRepeatApproval: false,
  allowWithdraw: true,
});

test("正常控件到持久审批的精确十进制", { skip: !isolated }, async (t) => {
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  let department;
  try {
    department = await call("/system/entries/departments", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    const user = async (label, approves) => {
      const role = await call("/system/roles", admin, "POST", {
        name: prefix + label,
        code: prefix + label,
        enabled: true,
        permissions: [
          "requests:view",
          "users:view",
          "messages:view",
          approves ? "requests:approve" : "requests:create",
        ],
        dataScopes: { users: "ALL" },
      });
      made.roles.push(role.id);
      const record = await call("/system/users", admin, "POST", {
        username: prefix + label,
        nickname: label,
        password,
        enabled: true,
        departmentId: department.id,
        roleIds: [role.id],
      });
      made.users.push(record.id);
      return {
        ...record,
        token: (await loginWithCaptcha(base, record.username, password)).token,
      };
    };
    const applicant = await user("app", false),
      a = await user("a", true),
      b = await user("b", true),
      c = await user("c", true);
    const category = (await call("/system/entries/approvalcategories", admin))
      .items[0];
    const controls = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/support/workflowDecimalControls.tsx"],
      {
        cwd: fileURLToPath(new URL("../frontend/", import.meta.url)),
        encoding: "utf8",
        timeout: 45000,
        windowsHide: true,
      },
    );
    assert.equal(
      controls.status,
      0,
      "真实 Ant 控件填写桥接必须成功，不以直接赋值替代",
    );
    const fixture = JSON.parse(controls.stdout);
    assert.deepEqual(fixture.values, {
      money: "999999999999999.99",
      number: "999999999999.123456",
      details: [{ amount: "99999999999999.99" }],
    });
    const fields = [
      ...fixture.fields,
      { id: "person", label: "人员", type: "USER", required: true },
      {
        id: "moneyCopy",
        label: "金额副本",
        type: "CALCULATED",
        required: true,
        formula: { operation: "SUM", operands: ["money"], scale: 2 },
      },
      {
        id: "numberCopy",
        label: "数字副本",
        type: "CALCULATED",
        required: true,
        formula: { operation: "SUM", operands: ["number"], scale: 6 },
      },
      {
        id: "detailTotal",
        label: "明细汇总",
        type: "CALCULATED",
        required: true,
        formula: {
          operation: "DETAIL_SUM",
          operands: ["details"],
          column: "amount",
          scale: 2,
        },
      },
    ];
    const values = { ...fixture.values, person: a.id };
    const publish = async (model) => {
      const draft = await call("/operations/workflows", admin, "POST", {
        name: prefix + " " + made.definitions.length,
        code: prefix + "_" + made.definitions.length,
        categoryId: category.id,
        businessType: "GENERAL",
        enabled: true,
        schema: model,
      });
      made.definitions.push(draft.id);
      assert(Number.isSafeInteger(draft.id));
      return call(`/operations/workflows/${draft.id}/publish`, admin, "POST", {
        version: draft.version,
      });
    };
    const detail = (id, token = admin) =>
      call(`/operations/requests/${id}`, token);
    const submit = (definition, data = values, draft = false, raw = false) => {
      const body = {
        definitionId: definition.id,
        versionId: definition.publishedVersionId,
        title: prefix,
        values: data,
      };
      const encoded = raw
        ? JSON.stringify(body)
            .replace(
              '"money":"999999999999999.99"',
              '"money":999999999999999.99',
            )
            .replace(
              '"number":"999999999999.123456"',
              '"number":999999999999.123456',
            )
            .replace(
              '"amount":"99999999999999.99"',
              '"amount":99999999999999.99',
            )
        : body;
      return call(
        `/operations/requests${draft ? "/drafts" : ""}`,
        applicant.token,
        "POST",
        encoded,
        200,
        raw,
      );
    };
    const decide = async (request, who, action = "APPROVE", extra = {}) => {
      const current = await detail(request.id, who.token);
      return call(
        `/operations/requests/${request.id}/decision`,
        who.token,
        "POST",
        {
          version: current.version,
          taskId: current.myTaskId,
          action,
          comment: "精确数值验收",
          ...extra,
        },
      );
    };
    const expected = (data = values) => ({
      ...data,
      moneyCopy: data.money,
      numberCopy: data.number,
      detailTotal: data.details[0].amount,
    });
    const lifecycle = schema(fields, [
      approval("review", a, "end", fields, ["money"]),
    ]);
    let mainDefinition;

    await t.test(
      "真实控件配置和填写产物保存发布后完整精确回显，实体与关联编号保持整数",
      async () => {
        mainDefinition = await publish(lifecycle);
        const configured = mainDefinition.schema.fields.find(
          (field) => field.id === "money",
        );
        assert.equal(configured.min, "999999999999999.98");
        assert.equal(configured.max, "999999999999999.99");
        const immutable = await call(
          `/operations/workflows/${mainDefinition.id}/versions`,
          admin,
        );
        assert.equal(
          immutable[0].schema.fields.find((field) => field.id === "money").max,
          configured.max,
        );
        const request = await submit(mainDefinition, values, true);
        assert.deepEqual(request.values, expected());
        assert.equal(typeof request.values.person, "number");
        assert(Number.isSafeInteger(request.id));
        const saved = await call(
          `/operations/requests/${request.id}`,
          applicant.token,
          "PUT",
          { version: request.version, title: prefix + " 保存", values },
        );
        assert.deepEqual(saved.values, expected());
        const submitted = await call(
          `/operations/requests/${request.id}/submit`,
          applicant.token,
          "POST",
          { version: saved.version, title: saved.title, values },
        );
        assert.deepEqual(submitted.values, expected());
        assert(Number.isSafeInteger(submitted.tasks[0].id));
        assert.deepEqual(
          submitted.history.find((row) => row.action === "SUBMIT")
            .submittedValues,
          expected(),
        );
        await decide(submitted, a);
      },
    );

    await t.test(
      "退回私人稿和重提保留精确值并隔离旧审批人，审批修改历史精确记录近邻金额",
      async () => {
        const request = await submit(mainDefinition);
        await decide(request, a, "RETURN");
        const returned = await detail(request.id, applicant.token);
        const changed = { ...values, money: "999999999999999.98" };
        const saved = await call(
          `/operations/requests/${request.id}`,
          applicant.token,
          "PUT",
          {
            version: returned.version,
            title: prefix + " 私稿",
            values: changed,
          },
        );
        assert.deepEqual(saved.values, expected(changed));
        const previous = await detail(request.id, a.token);
        assert.deepEqual(previous.values, expected());
        assert.deepEqual(
          (await detail(request.id)).values,
          expected(),
          "管理员也不能读取尚未提交新稿",
        );
        assert.equal(
          previous.history.find((row) => row.action === "SUBMIT")
            .submittedValues.money,
          values.money,
        );
        const submitted = await call(
          `/operations/requests/${request.id}/submit`,
          applicant.token,
          "POST",
          { version: saved.version, title: saved.title, values: changed },
        );
        assert.deepEqual(submitted.values, expected(changed));
        const approved = await decide(submitted, a, "APPROVE", {
          values: { money: values.money },
        });
        assert.deepEqual(approved.values, expected());
        const change = approved.history.at(-1).changes;
        assert.deepEqual(change.money, {
          before: changed.money,
          after: values.money,
        });
        assert.deepEqual(change.moneyCopy, {
          before: changed.money,
          after: values.money,
        });
        const oldSubmit = approved.history.find(
          (row) => row.action === "SUBMIT",
        );
        const newSubmit = approved.history.find(
          (row) => row.action === "RESUBMIT",
        );
        assert.equal(oldSubmit.submittedValues.money, values.money);
        assert.equal(newSubmit.submittedValues.money, changed.money);
      },
    );

    await t.test(
      "旧客户端真实数字token逐层解码为精确小数，过深/超量输入返回400",
      async () => {
        const request = await submit(mainDefinition, values, false, true);
        assert.deepEqual(request.values, expected());
        await decide(request, a);
        let nested = { leaf: 1 };
        for (let i = 0; i < 15; i++) nested = { nested };
        for (const bad of [
          { ...values, nested },
          { ...values, extra: Array(8193).fill(0) },
        ])
          await call(
            "/operations/requests",
            applicant.token,
            "POST",
            {
              definitionId: mainDefinition.id,
              versionId: mainDefinition.publishedVersionId,
              title: prefix,
              values: bad,
            },
            400,
          );
      },
    );

    await t.test(
      "合法大额金额的相邻分支不被浮点舍入合并，越界与超精度仍拒绝",
      async () => {
        const model = schema(fields, [
          {
            id: "choice",
            name: "精确近邻",
            type: "CONDITION",
            next: "lower",
            conditions: [
              {
                field: "money",
                operator: "EQ",
                value: values.money,
                next: "higher",
              },
            ],
          },
          approval("higher", a, "end", fields),
          approval("lower", b, "end", fields),
        ]);
        const definition = await publish(model);
        for (const [money, who, node] of [
          [values.money, a, "higher"],
          ["999999999999999.98", b, "lower"],
        ]) {
          const data = { ...values, money };
          const simulated = await call(
            "/operations/workflows/simulate",
            admin,
            "POST",
            { schema: model, applicantId: applicant.id, values: data },
          );
          assert.equal(simulated.path[1].id, node);
          const request = await submit(definition, data);
          assert.equal(request.currentNodeId, node);
          assert.equal(request.values.money, money);
          await decide(request, who);
        }
        for (const money of [
          "999999999999999.97",
          "1000000000000000.00",
          "999999999999999.991",
        ])
          await call(
            "/operations/requests",
            applicant.token,
            "POST",
            {
              definitionId: definition.id,
              versionId: definition.publishedVersionId,
              title: prefix,
              values: { ...values, money },
            },
            400,
          );
      },
    );

    await t.test(
      "数值CONTAINS保留计算scale，模拟/提交/审批修改后的执行采用相同表示",
      async () => {
        const fields = [
          { id: "price", label: "单价", type: "MONEY", required: true },
          { id: "quantity", label: "数量", type: "NUMBER", required: true },
          {
            id: "total",
            label: "总额",
            type: "CALCULATED",
            required: true,
            formula: {
              operation: "MULTIPLY",
              operands: ["price", "quantity"],
              scale: 2,
            },
          },
        ];
        const model = schema(fields, [
          {
            id: "initial",
            name: "包含小数位",
            type: "CONDITION",
            next: "wrong",
            conditions: [
              {
                field: "total",
                operator: "CONTAINS",
                value: ".00",
                next: "review",
              },
            ],
          },
          approval("review", a, "afterChoice", fields, ["price"]),
          {
            id: "afterChoice",
            name: "修改后判断",
            type: "CONDITION",
            next: "wrong",
            conditions: [
              {
                field: "total",
                operator: "CONTAINS",
                value: ".05",
                next: "matched",
              },
            ],
          },
          approval("matched", b, "end", fields),
          approval("wrong", c, "end", fields),
        ]);
        const definition = await publish(model),
          data = { price: "100.00", quantity: "5" };
        const simulated = await call(
          "/operations/workflows/simulate",
          admin,
          "POST",
          { schema: model, applicantId: applicant.id, values: data },
        );
        assert.equal(simulated.path[1].id, "review");
        const request = await submit(definition, data);
        assert.equal(request.currentNodeId, "review");
        assert.equal(request.values.total, "500.00");
        const approved = await decide(request, a, "APPROVE", {
          values: { price: "101.01" },
        });
        assert.equal(approved.currentNodeId, "matched");
        assert.equal(approved.values.total, "505.05");
        assert.deepEqual(approved.history.at(-1).changes.total, {
          before: "500.00",
          after: "505.05",
        });
        await decide(request, b);
      },
    );

    await t.test(
      "固定子版本输入输出和父级派生重算完整保留精确值、明细与整数人员编号",
      async () => {
        const childModel = schema(fields, [
          approval("childReview", a, "end", fields, ["money"]),
        ]);
        const child = await publish(childModel);
        const parentFields = [
          ...fields,
          { id: "output", label: "返回金额", type: "MONEY", required: true },
          {
            id: "outputCopy",
            label: "返回金额计算",
            type: "CALCULATED",
            required: true,
            formula: { operation: "SUM", operands: ["output"], scale: 2 },
          },
        ];
        const model = schema(parentFields, [
          {
            id: "child",
            name: "固定金额子流程",
            type: "SUBPROCESS",
            next: "choice",
            // 子调用读取四项显式输入及返回字段 output；可写 output 同时必须可读。
            // 双方的 CALCULATED 字段按各自冻结公式重算，不能作为额外输入或可写字段授权。
            readable: ["money", "number", "details", "person", "output"],
            writable: ["output"],
            subprocess: {
              versionId: child.publishedVersionId,
              inputs: {
                money: "money",
                number: "number",
                details: "details",
                person: "person",
              },
              outputs: { output: "money" },
            },
          },
          {
            id: "choice",
            name: "精确返回判断",
            type: "CONDITION",
            next: "wrong",
            conditions: [
              {
                field: "output",
                operator: "EQ",
                value: "999999999999999.98",
                next: "matched",
              },
            ],
          },
          approval("matched", b, "end", parentFields),
          approval("wrong", c, "end", parentFields),
        ]);
        const parent = await publish(model),
          request = await submit(parent, { ...values, output: values.money });
        assert.equal(request.childRequests.length, 1);
        const childRequest = await detail(request.childRequests[0].id);
        assert.deepEqual(childRequest.values, expected());
        assert.equal(
          childRequest.definitionVersionId,
          child.publishedVersionId,
        );
        await decide(childRequest, a, "APPROVE", {
          values: { money: "999999999999999.98" },
        });
        const resumed = await detail(request.id);
        assert.equal(resumed.currentNodeId, "matched");
        assert.equal(resumed.values.output, "999999999999999.98");
        assert.equal(resumed.values.outputCopy, "999999999999999.98");
        assert.equal(
          resumed.values.money,
          values.money,
          "子流程不得改写未映射的父字段",
        );
        assert.equal(typeof resumed.values.person, "number");
        await decide(request, b);
      },
    );
    await t.test(
      "旧合法负scale数值从模拟到草稿回读无改重存及退回重提保持原分支",
      async () => {
        assert.deepEqual(
          fixture.exponent.values,
          { exponent: "1E+3" },
          "真实 Ant 回填聚焦失焦和正常提交不能改写旧指数值",
        );
        const fields = fixture.exponent.fields;
        const model = schema(fields, [
          {
            id: "choice",
            name: "旧表示包含判断",
            type: "CONDITION",
            next: "unchanged",
            conditions: [
              {
                field: "exponent",
                operator: "CONTAINS",
                value: "000",
                next: "expanded",
              },
            ],
          },
          approval("expanded", a, "end", fields),
          approval("unchanged", b, "end", fields),
        ]);
        const definition = await publish(model);
        for (const raw of [false, true]) {
          const data = { exponent: "1e3" },
            body = { schema: model, applicantId: applicant.id, values: data };
          const simulated = await call(
            "/operations/workflows/simulate",
            admin,
            "POST",
            raw
              ? JSON.stringify(body).replace(
                  '"exponent":"1e3"',
                  '"exponent":1e3',
                )
              : body,
            200,
            raw,
          );
          assert.equal(simulated.path[1].id, "unchanged");
          const submission = {
            definitionId: definition.id,
            versionId: definition.publishedVersionId,
            title: prefix + " 原指数",
            values: data,
          };
          // 直接发起也验证旧数字 literal 与字符串路径，而不只验证草稿正规化后的提交。
          const legacySubmitted = await call(
            "/operations/requests",
            applicant.token,
            "POST",
            raw
              ? JSON.stringify(submission).replace(
                  '"exponent":"1e3"',
                  '"exponent":1e3',
                )
              : submission,
            200,
            raw,
          );
          assert.equal(legacySubmitted.currentNodeId, "unchanged");
          assert.equal(legacySubmitted.values.exponent, "1E+3");
          assert.equal(
            legacySubmitted.history.find((row) => row.action === "SUBMIT")
              .submittedValues.exponent,
            "1E+3",
          );
          await decide(legacySubmitted, b);
          const draft = await call(
            "/operations/requests/drafts",
            applicant.token,
            "POST",
            raw
              ? JSON.stringify(submission).replace(
                  '"exponent":"1e3"',
                  '"exponent":1e3',
                )
              : submission,
            200,
            raw,
          );
          assert.deepEqual(draft.values, { exponent: "1E+3" });
          const hydrated = await detail(draft.id, applicant.token);
          const saved = await call(
            `/operations/requests/${draft.id}`,
            applicant.token,
            "PUT",
            {
              version: hydrated.version,
              title: hydrated.title,
              values: fixture.exponent.values,
            },
          );
          assert.deepEqual(saved.values, hydrated.values);
          const submitted = await call(
            `/operations/requests/${draft.id}/submit`,
            applicant.token,
            "POST",
            {
              version: saved.version,
              title: saved.title,
              values: saved.values,
            },
          );
          assert.equal(submitted.currentNodeId, "unchanged");
          assert.equal(submitted.values.exponent, "1E+3");
          assert.equal(
            submitted.history.find((row) => row.action === "SUBMIT")
              .submittedValues.exponent,
            "1E+3",
          );
          await decide(submitted, b, "RETURN");
          const returned = await detail(submitted.id, applicant.token);
          const privateSaved = await call(
            `/operations/requests/${submitted.id}`,
            applicant.token,
            "PUT",
            {
              version: returned.version,
              title: returned.title,
              values: returned.values,
            },
          );
          assert.equal(privateSaved.values.exponent, "1E+3");
          const resumed = await call(
            `/operations/requests/${submitted.id}/submit`,
            applicant.token,
            "POST",
            {
              version: privateSaved.version,
              title: privateSaved.title,
              values: privateSaved.values,
            },
          );
          assert.equal(resumed.currentNodeId, "unchanged");
          assert.equal(resumed.values.exponent, "1E+3");
          assert.equal(
            resumed.history.find((row) => row.action === "RESUBMIT")
              .submittedValues.exponent,
            "1E+3",
          );
          await decide(resumed, b);
        }
        const direct = await submit(definition, fixture.exponent.values);
        assert.equal(direct.currentNodeId, "unchanged");
        assert.equal(direct.values.exponent, "1E+3");
        await decide(direct, b);
      },
    );
  } finally {
    // 将本批所有父子实例精确登记，按编号降序逐条删叶子，不能删除其他申请人的业务或测试数据。
    const owned = made.users.length
      ? sql(
          `SELECT id FROM ops_flow_request WHERE definition_id IN (${ids(made.definitions)}) AND applicant_id IN (${ids(made.users)}) ORDER BY id DESC;`,
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
      : [];
    const requests = ids(owned),
      definitions = ids(made.definitions);
    sql(`START TRANSACTION; SELECT id FROM ops_event WHERE request_id IN (${requests}) FOR UPDATE;
      DELETE d FROM ops_delivery d JOIN ops_notification n ON n.id=d.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE t FROM ops_notification_target t JOIN ops_notification n ON n.id=t.notification_id WHERE n.target_type='APPROVAL' AND n.target_id IN (${requests});
      DELETE FROM ops_notification WHERE target_type='APPROVAL' AND target_id IN (${requests});
      DELETE FROM ops_event WHERE request_id IN (${requests}); DELETE FROM ops_flow_task WHERE request_id IN (${requests}); DELETE FROM ops_flow_decision WHERE request_id IN (${requests});
      DELETE FROM ops_request_step WHERE request_id IN (${requests}); DELETE FROM ops_request_file WHERE request_id IN (${requests});
      ${owned.map((id) => `DELETE FROM ops_flow_request WHERE id=${id};`).join("\n")}
      DELETE FROM ops_flow_step WHERE definition_id IN (${definitions}); DELETE FROM ops_flow_version WHERE definition_id IN (${definitions}); DELETE FROM ops_flow_definition WHERE id IN (${definitions}); COMMIT;`);
    for (const id of made.users)
      await call(`/system/users/${id}`, admin, "DELETE");
    for (const id of made.roles)
      await call(`/system/roles/${id}`, admin, "DELETE");
    if (department)
      await call(
        `/system/entries/departments/${department.id}`,
        admin,
        "DELETE",
      );
    await call("/auth/logout", admin, "POST");
  }
});
