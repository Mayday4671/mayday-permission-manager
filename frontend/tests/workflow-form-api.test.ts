import assert from "node:assert/strict";
import test from "node:test";
import { loginWithCaptcha } from "../../tests/support/captcha.mjs";
import {
  copyWorkflowField,
  createWorkflowField,
  insertWorkflowField,
  moveWorkflowField,
  removeWorkflowField,
  validateWorkflowFormReferences,
  validateWorkflowFormValues,
  validateWorkflowFields,
} from "../src/lib/workflowForm";
import {
  fieldNames,
  initialSpec,
  type FieldType,
  type WorkflowField,
  type WorkflowNode,
  type WorkflowSpec,
} from "../src/types/workflow";

/**
 * 设计器真实字段操作结果交给 Java 发布级校验和表单校验。默认无显式环境时跳过；
 * 只允许本机独立验收项目，拒绝日常 18080。网络白名单仅含模拟和只读查询，
 * 不保存定义、发布版本、申请、附件或待办；凭证及会话从不出现在诊断输出中。
 */
const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const apiUrl = base ? new URL(base) : null;
const isolated = Boolean(
  apiUrl &&
  ["127.0.0.1", "localhost", "[::1]"].includes(apiUrl.hostname) &&
  apiUrl.pathname === "/api" &&
  apiUrl.port !== "18080" &&
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? ""),
);

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

interface Simulation {
  valid: boolean;
  path: {
    id: string;
    type: WorkflowNode["type"];
    approvers: { id: number }[];
  }[];
}

const readPaths = new Set([
  "/auth/me",
  "/operations/workflows?page=1&size=1",
  "/operations/requests?box=all&page=1&size=1",
]);

/** 请求失败只输出公开路径、状态及业务错误，不回显请求内容或任何登录资料。 */
async function call<T>(
  path: string,
  token: string,
  data?: unknown,
  expected = 200,
): Promise<ApiEnvelope<T>> {
  assert.ok(isolated, "必须显式指定本机隔离验收环境，禁止日常 18080");
  assert.ok(
    data === undefined
      ? readPaths.has(path)
      : path === "/operations/workflows/simulate",
    "字段兼容验收只允许只读查询和不持久化模拟",
  );
  const response = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  assert.equal(
    response.status,
    expected,
    `${path}: ${response.status}; ${body.message ?? ""}`,
  );
  assert.equal(
    body.success,
    expected === 200,
    `${path} 的成功标志应与状态一致`,
  );
  return body;
}

/** 合成流程指定隔离管理员审批；自审开关只存在于内存模型，不授予真实账号权限。 */
function configured(fields: WorkflowField[], personId: number): WorkflowSpec {
  const schema = initialSpec();
  schema.fields = structuredClone(fields);
  schema.allowSelfApproval = true;
  schema.allowRepeatApproval = true;
  schema.nodes[0].assigneeIds = [personId];
  schema.nodes[0].readable = fields.map((field) => field.id);
  schema.nodes[0].writable = [];
  return schema;
}

/** 使用真实控件库默认值构造完整字段组合，不另写会偏离设计器的替代契约。 */
function allFields(): WorkflowField[] {
  const fields: WorkflowField[] = [];
  for (const type of Object.keys(fieldNames) as FieldType[])
    fields.push(createWorkflowField(type, fields));
  return fields;
}

test(
  "表单编排结果通过真实 Java 字段及表单校验，失败配置不能模拟执行且不写业务记录",
  { skip: !base && !project },
  async (context) => {
    assert.ok(isolated, "必须显式指定本机隔离验收环境，禁止日常 18080");
    assert.ok(process.env.ADMIN_PASSWORD, "隔离验收需要进程提供管理员密码");
    const authenticated = await loginWithCaptcha(
      base,
      "admin",
      process.env.ADMIN_PASSWORD,
    );
    const token: string = authenticated.token;
    const identity = (
      await call<{
        admin: boolean;
        user: { id: number; departmentId?: number | null };
      }>("/auth/me", token)
    ).data;
    assert.equal(identity.admin, true, "只用隔离管理员模拟，不修改账号或权限");
    const personId = identity.user.id;
    assert.ok(Number.isSafeInteger(personId) && personId > 0);
    const beforeDefinitions = (
      await call<{ total: number }>(
        "/operations/workflows?page=1&size=1",
        token,
      )
    ).data.total;
    const beforeRequests = (
      await call<{ total: number }>(
        "/operations/requests?box=all&page=1&size=1",
        token,
      )
    ).data.total;
    let successful = 0;
    let rejected = 0;

    /** 真实模拟验证人员解析和返回路径；普通字段值不用于修改模拟发起人的属性。 */
    const simulate = async (
      schema: WorkflowSpec,
      values: Record<string, unknown> = {},
    ) => {
      assert.deepEqual(
        validateWorkflowFields(schema.fields),
        [],
        "有效编排应通过客户端字段校验",
      );
      assert.deepEqual(
        validateWorkflowFormReferences(schema),
        [],
        "有效条件应保留原选项引用",
      );
      assert.deepEqual(
        validateWorkflowFormValues(schema.fields, values),
        [],
        "有效预览值与 Java 表单校验应一致",
      );
      const response = await call<Simulation>(
        "/operations/workflows/simulate",
        token,
        { schema, applicantId: personId, values },
      );
      successful++;
      assert.equal(response.data.valid, true);
      for (const node of response.data.path)
        assert.deepEqual(
          node.approvers.map((person) => person.id),
          node.type === "APPROVAL" || node.type === "COPY" ? [personId] : [],
        );
      return response.data.path.map((node) => node.id);
    };

    const reject = async (
      schema: WorkflowSpec,
      values: Record<string, unknown>,
      message: RegExp,
    ) => {
      const response = await call<never>(
        "/operations/workflows/simulate",
        token,
        { schema, applicantId: personId, values },
        400,
      );
      rejected++;
      assert.match(response.message ?? "", message);
    };

    try {
      const fields = allFields();
      const complete = configured(fields, personId);

      await context.test(
        "全部 13 类默认控件和组合可模拟，选项及明细默认值符合发布标准",
        async () => {
          assert.equal(fields.length, 13);
          assert.deepEqual(await simulate(complete), ["review", "end"]);
          for (const field of fields)
            assert.deepEqual(await simulate(configured([field], personId)), [
              "review",
              "end",
            ]);
        },
      );

      await context.test(
        "真实值覆盖日期区间、明细行、金额精度及选项，预览不上传真实附件",
        async () => {
          const values: Record<string, unknown> = {};
          for (const field of fields) {
            const byType: Record<FieldType, unknown> = {
              TEXT: "采购申请",
              TEXTAREA: "请核对明细\n第二行说明",
              NUMBER: 42.123456,
              MONEY: 123.45,
              DATE: "2026-10-03",
              DATETIME: "2026-10-03T10:30:00",
              DATE_RANGE: ["2026-10-01", "2026-10-03"],
              DETAILS: [
                { item: "交通", amount: 30.25 },
                { item: "住宿", amount: 200 },
              ],
              SINGLE: "选项1",
              MULTI: ["选项1", "选项2"],
              USER: personId,
              // 模拟端仅校验关联值为正整数；归属和访问范围仍在实际提交端执行。
              DEPARTMENT: identity.user.departmentId ?? personId,
              FILES: [],
            };
            values[field.id] = byType[field.type];
          }
          assert.deepEqual(await simulate(complete, values), ["review", "end"]);
        },
      );

      await context.test(
        "重排、插入和复制保持节点与授权不变，明细副本列仍局部唯一",
        async () => {
          const original = structuredClone(complete);
          const details = fields.find((field) => field.type === "DETAILS")!;
          const reordered = moveWorkflowField(
            complete,
            details.id,
            fields[0].id,
          );
          const copied = copyWorkflowField(reordered, details.id);
          const inserted = insertWorkflowField(copied, 1, "SINGLE");
          for (const schema of [reordered, copied, inserted]) {
            assert.deepEqual(schema.nodes, complete.nodes);
            assert.deepEqual(await simulate(schema), ["review", "end"]);
          }
          assert.deepEqual(complete, original);
        },
      );

      await context.test(
        "金额条件在字段重排和复制后引用稳定 ID，命中与默认路径均正确",
        async () => {
          const amount = fields.find((field) => field.type === "MONEY")!;
          const schema = configured([amount], personId);
          schema.nodes[0].next = "condition";
          schema.nodes.push({
            id: "condition",
            name: "金额判断",
            type: "CONDITION",
            next: "end",
            conditions: [
              {
                field: amount.id,
                operator: "GE",
                value: "5000",
                next: "finance",
              },
            ],
          });
          schema.nodes.push({
            ...structuredClone(schema.nodes[0]),
            id: "finance",
            name: "财务审批",
            next: "end",
          });
          const copied = copyWorkflowField(schema, amount.id);
          const reordered = moveWorkflowField(copied, amount.id, null);
          for (const value of [schema, reordered]) {
            assert.deepEqual(await simulate(value, { [amount.id]: 5000 }), [
              "review",
              "condition",
              "finance",
              "end",
            ]);
            assert.deepEqual(await simulate(value, { [amount.id]: 4999.99 }), [
              "review",
              "condition",
              "end",
            ]);
          }
          assert.throws(
            () => removeWorkflowField(schema, amount.id),
            /金额判断.*先修改分支条件/,
          );
        },
      );

      await context.test(
        "单选选项引用两端一致校验，改名或错误 trim 的 EQ/NE 不能发布级模拟",
        async () => {
          const field: WorkflowField = {
            id: "kind",
            label: "申请类型",
            type: "SINGLE",
            options: [" 差旅 ", "采购"],
          };
          for (const operator of ["EQ", "NE"] as const) {
            const schema = configured([field], personId);
            schema.nodes[0].next = "choice";
            schema.nodes.push({
              id: "choice",
              name: "类型判断",
              type: "CONDITION",
              next: "end",
              conditions: [
                { field: field.id, operator, value: " 差旅 ", next: "matched" },
              ],
            });
            schema.nodes.push({ id: "matched", name: "条件结束", type: "END" });
            assert.deepEqual(await simulate(schema, { kind: " 差旅 " }), [
              "review",
              "choice",
              operator === "EQ" ? "matched" : "end",
            ]);
            assert.deepEqual(await simulate(schema, { kind: "采购" }), [
              "review",
              "choice",
              operator === "NE" ? "matched" : "end",
            ]);
            const renamed = structuredClone(schema);
            renamed.fields[0].options = ["服务", "采购"];
            assert.equal(validateWorkflowFormReferences(renamed).length, 1);
            await reject(
              renamed,
              { kind: "服务" },
              /类型判断.*申请类型.*选项已不存在/,
            );
            const trimmed = structuredClone(schema);
            trimmed.nodes[2].conditions![0].value = "差旅";
            assert.equal(validateWorkflowFormReferences(trimmed).length, 1);
            await reject(
              trimmed,
              { kind: "采购" },
              /类型判断.*申请类型.*选项已不存在/,
            );
          }
          const contains = configured([field], personId);
          contains.nodes[0].next = "choice";
          contains.nodes.push({
            id: "choice",
            name: "包含判断",
            type: "CONDITION",
            next: "end",
            conditions: [
              {
                field: field.id,
                operator: "CONTAINS",
                value: "差旅",
                next: "end",
              },
            ],
          });
          assert.deepEqual(await simulate(contains, { kind: " 差旅 " }), [
            "review",
            "choice",
            "end",
          ]);
        },
      );

      await context.test(
        "删除非条件字段只清自身权限，旧省略布局和可选属性仍通过 Java",
        async () => {
          const removed = removeWorkflowField(complete, fields[0].id);
          assert.deepEqual(await simulate(removed), ["review", "end"]);
          assert.equal(
            removed.nodes[0].readable?.includes(fields[0].id),
            false,
          );
          const old: WorkflowField[] = [
            { id: "old_memo", label: "说明", type: "TEXT" },
            { id: "old_amount", label: "金额", type: "MONEY" },
            {
              id: "old_items",
              label: "明细",
              type: "DETAILS",
              columns: [{ id: "item", label: "项目", type: "TEXT" }],
            },
          ];
          const original = structuredClone(old);
          assert.deepEqual(
            await simulate(configured(old, personId), {
              old_memo: "保留旧模型",
              old_amount: 12.3,
              old_items: [{ item: "交通" }],
            }),
            ["review", "end"],
          );
          assert.deepEqual(old, original);
        },
      );

      await context.test(
        "无效字段属性在前端有定位错误并被 Java 400 拒绝",
        async () => {
          const text = createWorkflowField("TEXT", []);
          const single = createWorkflowField("SINGLE", []);
          const details = createWorkflowField("DETAILS", []);
          const invalid: { fields: WorkflowField[]; message: RegExp }[] = [
            { fields: [{ ...text, id: "1illegal" }], message: /字段 ID/ },
            { fields: [text, structuredClone(text)], message: /字段 ID/ },
            { fields: [{ ...text, label: " " }], message: /名称或类型/ },
            { fields: [{ ...text, width: 8 as 12 }], message: /布局/ },
            {
              fields: [{ ...single, options: ["同值", "同值"] }],
              message: /选择项/,
            },
            { fields: [{ ...single, options: [" "] }], message: /选择项/ },
            {
              fields: [{ ...single, options: ["值".repeat(101)] }],
              message: /选择项/,
            },
            {
              fields: [
                {
                  ...single,
                  type: "MULTI",
                  options: Array.from({ length: 51 }, (_, index) =>
                    String(index),
                  ),
                },
              ],
              message: /选择项/,
            },
            { fields: [{ ...text, min: 2, max: 1 }], message: /下限/ },
            { fields: [{ ...text, maxLength: 10001 }], message: /文本长度/ },
            { fields: [{ ...details, maxRows: 51 }], message: /明细最多/ },
            {
              fields: [
                {
                  ...details,
                  columns: Array.from({ length: 7 }, (_, index) => ({
                    ...text,
                    id: `col${index}`,
                  })),
                },
              ],
              message: /1 至 6 列/,
            },
            {
              fields: [{ ...details, columns: [text, structuredClone(text)] }],
              message: /字段 ID/,
            },
            {
              fields: [{ ...details, columns: [{ ...text, type: "FILES" }] }],
              message: /明细列只支持/,
            },
            { fields: [{ ...text, columns: [text] }], message: /只有明细表/ },
            {
              fields: Array.from({ length: 41 }, (_, index) => ({
                ...text,
                id: `field${index}`,
              })),
              message: /最多 40/,
            },
          ];
          for (const example of invalid) {
            assert.ok(validateWorkflowFields(example.fields).length > 0);
            await reject(
              configured(example.fields, personId),
              {},
              example.message,
            );
          }
        },
      );

      await context.test(
        "合法模型的非法提交值仍由 Java 校验，不因画布校验成功绕过规则",
        async () => {
          const find = (type: FieldType) => createWorkflowField(type, []);
          const text = find("TEXT");
          const money = find("MONEY");
          const details = find("DETAILS");
          const invalid: {
            field: WorkflowField;
            value: unknown;
            message: RegExp;
          }[] = [
            {
              field: { ...text, required: true },
              value: "",
              message: /不能为空/,
            },
            { field: money, value: 1.001, message: /精度/ },
            { field: money, value: -1, message: /允许范围/ },
            { field: find("NUMBER"), value: 1.0000001, message: /精度/ },
            { field: find("SINGLE"), value: "不存在", message: /无效选项/ },
            {
              field: find("MULTI"),
              value: ["选项1", "选项1"],
              message: /数量超限或存在重复/,
            },
            { field: find("MULTI"), value: ["不存在"], message: /无效选项/ },
            { field: find("DATE"), value: "2026-02-30", message: /日期格式/ },
            {
              field: find("DATE_RANGE"),
              value: ["2026-10-03", "2026-10-01"],
              message: /结束日期/,
            },
            {
              field: find("DATE_RANGE"),
              value: ["2026-10-03"],
              message: /起止日期/,
            },
            {
              field: details,
              value: [{ item: "交通", amount: 1, unknown: true }],
              message: /未登记字段/,
            },
            { field: details, value: [{ item: "交通" }], message: /不能为空/ },
            {
              field: details,
              value: Array.from({ length: 21 }, () => ({
                item: "交通",
                amount: 1,
              })),
              message: /明细行数超限/,
            },
          ];
          for (const example of invalid) {
            const schema = configured([example.field], personId);
            assert.deepEqual(validateWorkflowFields(schema.fields), []);
            assert.ok(
              validateWorkflowFormValues(schema.fields, {
                [example.field.id]: example.value,
              }).length > 0,
            );
            await reject(
              schema,
              { [example.field.id]: example.value },
              example.message,
            );
          }
          await reject(
            configured([text], personId),
            { undeclared: "不允许扩展键" },
            /未登记字段/,
          );
        },
      );
    } finally {
      const afterDefinitions = (
        await call<{ total: number }>(
          "/operations/workflows?page=1&size=1",
          token,
        )
      ).data.total;
      const afterRequests = (
        await call<{ total: number }>(
          "/operations/requests?box=all&page=1&size=1",
          token,
        )
      ).data.total;
      assert.equal(
        afterDefinitions,
        beforeDefinitions,
        "模拟不能增删或发布流程定义",
      );
      assert.equal(afterRequests, beforeRequests, "模拟不能创建或修改申请");
      context.diagnostic(
        `真实 Java 字段验收：成功 ${successful} 次，预期 400 ${rejected} 次；定义 ${beforeDefinitions}→${afterDefinitions}，申请 ${beforeRequests}→${afterRequests}。`,
      );
    }
  },
);
