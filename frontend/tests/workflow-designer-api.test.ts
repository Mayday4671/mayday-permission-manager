import assert from "node:assert/strict";
import test from "node:test";
import { loginWithCaptcha } from "../../tests/support/captcha.mjs";
import {
  addWorkflowBranch,
  deleteWorkflowBranch,
  insertWorkflowNode,
  insertWorkflowNodeAfterBranches,
  moveWorkflowBranch,
  removeWorkflowNode,
} from "../src/lib/workflowGraph";
import {
  initialSpec,
  type WorkflowNode,
  type WorkflowSpec,
} from "../src/types/workflow";

/**
 * 将设计器真实自动接线函数产生的模型交给 Java 的完整发布校验与路径模拟。
 * 只允许显式指定的本机独立验收环境，默认前端单元检查会跳过；不创建或发布流程，
 * 不修改用户、权限和业务记录。登录经过现有 HTTP 验证辅助，凭证只从进程环境读取。
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

/** 失败仅输出请求路径、状态和公开错误信息，不输出身份令牌或管理员密码。 */
async function call<T>(
  path: string,
  token: string,
  data?: unknown,
  expected = 200,
): Promise<ApiEnvelope<T>> {
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
  if (expected === 200) assert.equal(body.success, true, `${path} 应成功`);
  return body;
}

function findNode(schema: WorkflowSpec, id: string): WorkflowNode {
  const node = schema.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `结构中应存在节点 ${id}`);
  return node;
}

/** 测试账号只指定给合成模型；相当于页面完成审批人设置，不更新该账号或任何持久流程。 */
function configured(schema: WorkflowSpec, personId: number): WorkflowSpec {
  const result = structuredClone(schema);
  result.allowSelfApproval = true;
  result.allowRepeatApproval = true;
  for (const node of result.nodes)
    if (node.type === "APPROVAL" || node.type === "COPY") {
      node.source = "USERS";
      node.assigneeIds = [personId];
    }
  return result;
}

/** 所有分支先经过基础审批节点，因此条件为空分支也不能绕过审批。 */
function baseSchema(): WorkflowSpec {
  const result = initialSpec();
  result.fields.push({
    id: "amount",
    label: "申请金额",
    type: "MONEY",
    required: true,
  });
  return result;
}

/** 在两条确切条件出口分别添加审批及抄送，汇合前不会错误修改另一条同目标出口。 */
function branchedSchema(): WorkflowSpec {
  let result = insertWorkflowNode(
    baseSchema(),
    { sourceId: "review", branchIndex: null, targetId: "end" },
    "CONDITION",
  );
  const condition = findNode(result, "condition_1");
  condition.conditions![0] = {
    field: "amount",
    operator: "GE",
    value: "100",
    next: "end",
  };
  result = insertWorkflowNode(
    result,
    { sourceId: condition.id, branchIndex: 0, targetId: "end" },
    "APPROVAL",
  );
  return insertWorkflowNode(
    result,
    { sourceId: condition.id, branchIndex: null, targetId: "end" },
    "COPY",
  );
}

test(
  "设计器自动接线模型通过真实 Java 发布级校验及分支路径模拟",
  { skip: !isolated },
  async (context) => {
    assert.ok(process.env.ADMIN_PASSWORD, "隔离验收需要进程提供管理员密码");
    const authenticated = await loginWithCaptcha(
      base,
      "admin",
      process.env.ADMIN_PASSWORD,
    );
    const token: string = authenticated.token;
    const identity = (
      await call<{ user: { id: number }; admin: boolean }>("/auth/me", token)
    ).data;
    assert.equal(
      identity.admin,
      true,
      "只用隔离管理员模拟人员，不授予或调整其他账号权限",
    );
    const personId = identity.user.id;
    assert.ok(Number.isSafeInteger(personId));
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

    /** 验证服务端返回的真实路径及每个人员节点，不以客户端结构断言冒充运行验收。 */
    const simulate = async (
      schema: WorkflowSpec,
      amount: number,
      description = "正常申请",
    ) => {
      const response = await call<Simulation>(
        "/operations/workflows/simulate",
        token,
        {
          schema: configured(schema, personId),
          applicantId: personId,
          values: { amount, description },
        },
      );
      assert.equal(response.data.valid, true);
      for (const step of response.data.path)
        assert.deepEqual(
          step.approvers.map((person) => person.id),
          step.type === "APPROVAL" || step.type === "COPY" ? [personId] : [],
        );
      return response.data.path.map((step) => step.id);
    };

    await context.test(
      "入口和普通连接线插入审批、抄送后执行次序与页面位置一致",
      async () => {
        let result = insertWorkflowNode(
          baseSchema(),
          { sourceId: null, branchIndex: null, targetId: "review" },
          "APPROVAL",
        );
        result = insertWorkflowNode(
          result,
          { sourceId: "review", branchIndex: null, targetId: "end" },
          "COPY",
        );
        assert.deepEqual(await simulate(result, 50), [
          "approval_1",
          "review",
          "copy_1",
          "end",
        ]);
      },
    );

    await context.test(
      "条件命中走规则出口，未命中只走默认出口，不混入另一支人员",
      async () => {
        const result = branchedSchema();
        assert.deepEqual(await simulate(result, 100), [
          "review",
          "condition_1",
          "approval_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 99.99), [
          "review",
          "condition_1",
          "copy_1",
          "end",
        ]);
      },
    );

    await context.test(
      "分支汇合后添加共享审批，两条真实执行路径都只经过一次",
      async () => {
        const result = insertWorkflowNodeAfterBranches(
          branchedSchema(),
          "condition_1",
          "APPROVAL",
        );
        assert.deepEqual(await simulate(result, 100), [
          "review",
          "condition_1",
          "approval_1",
          "approval_2",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 50), [
          "review",
          "condition_1",
          "copy_1",
          "approval_2",
          "end",
        ]);
      },
    );

    await context.test(
      "在某条规则中嵌套条件，只影响该规则；嵌套默认及命中路径均正确",
      async () => {
        let result = insertWorkflowNode(
          branchedSchema(),
          { sourceId: "condition_1", branchIndex: 0, targetId: "approval_1" },
          "CONDITION",
        );
        findNode(result, "condition_2").conditions![0] = {
          field: "description",
          operator: "CONTAINS",
          value: "加急",
          next: "approval_1",
        };
        result = insertWorkflowNode(
          result,
          { sourceId: "condition_2", branchIndex: 0, targetId: "approval_1" },
          "COPY",
        );
        assert.deepEqual(await simulate(result, 200, "加急申请"), [
          "review",
          "condition_1",
          "condition_2",
          "copy_2",
          "approval_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 200), [
          "review",
          "condition_1",
          "condition_2",
          "approval_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 50, "加急申请"), [
          "review",
          "condition_1",
          "copy_1",
          "end",
        ]);
      },
    );

    await context.test(
      "删除节点自动接回原后继，删除条件组保留默认路线并清理专属分支",
      async () => {
        const result = removeWorkflowNode(branchedSchema(), "approval_1");
        assert.deepEqual(await simulate(result, 200), [
          "review",
          "condition_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 50), [
          "review",
          "condition_1",
          "copy_1",
          "end",
        ]);
        const withoutCondition = removeWorkflowNode(
          branchedSchema(),
          "condition_1",
        );
        assert.deepEqual(await simulate(withoutCondition, 200), [
          "review",
          "copy_1",
          "end",
        ]);
        assert.deepEqual(await simulate(withoutCondition, 50), [
          "review",
          "copy_1",
          "end",
        ]);
        assert.equal(
          withoutCondition.nodes.some((node) => node.id === "approval_1"),
          false,
        );
      },
    );

    await context.test(
      "新增、调整优先级及删除分支同步改变服务端实际路由，默认路径保持稳定",
      async () => {
        let result = addWorkflowBranch(branchedSchema(), "condition_1");
        findNode(result, "condition_1").conditions![1] = {
          field: "amount",
          operator: "GE",
          value: "10",
          next: "copy_1",
        };
        result = insertWorkflowNode(
          result,
          { sourceId: "condition_1", branchIndex: 1, targetId: "copy_1" },
          "APPROVAL",
        );
        assert.deepEqual(await simulate(result, 150), [
          "review",
          "condition_1",
          "approval_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 20), [
          "review",
          "condition_1",
          "approval_2",
          "copy_1",
          "end",
        ]);
        result = moveWorkflowBranch(result, "condition_1", 1, 0);
        assert.deepEqual(await simulate(result, 150), [
          "review",
          "condition_1",
          "approval_2",
          "copy_1",
          "end",
        ]);
        result = deleteWorkflowBranch(result, "condition_1", 0);
        assert.deepEqual(await simulate(result, 150), [
          "review",
          "condition_1",
          "approval_1",
          "end",
        ]);
        assert.deepEqual(await simulate(result, 1), [
          "review",
          "condition_1",
          "copy_1",
          "end",
        ]);
        assert.equal(
          result.nodes.some((node) => node.id === "approval_2"),
          false,
        );
      },
    );

    await context.test(
      "画布新增但未配置的条件及人员在发布级模拟被拒绝，不生成业务申请",
      async () => {
        const incompleteCondition = insertWorkflowNode(
          baseSchema(),
          { sourceId: "review", branchIndex: null, targetId: "end" },
          "CONDITION",
        );
        const rejectedCondition = await call<never>(
          "/operations/workflows/simulate",
          token,
          {
            schema: configured(incompleteCondition, personId),
            values: { description: "不应创建", amount: 100 },
          },
          400,
        );
        assert.equal(rejectedCondition.success, false);
        assert.match(rejectedCondition.message ?? "", /分支条件/);
        const incompleteApproval = configured(
          insertWorkflowNode(
            baseSchema(),
            { sourceId: "review", branchIndex: null, targetId: "end" },
            "APPROVAL",
          ),
          personId,
        );
        findNode(incompleteApproval, "approval_1").assigneeIds = [];
        const rejectedApproval = await call<never>(
          "/operations/workflows/simulate",
          token,
          {
            schema: incompleteApproval,
            values: { description: "不应创建", amount: 100 },
          },
          400,
        );
        assert.equal(rejectedApproval.success, false);
        assert.match(rejectedApproval.message ?? "", /审批人来源不能为空/);
      },
    );

    assert.equal(
      (
        await call<{ total: number }>(
          "/operations/workflows?page=1&size=1",
          token,
        )
      ).data.total,
      beforeDefinitions,
      "模拟不得新增或发布流程定义",
    );
    assert.equal(
      (
        await call<{ total: number }>(
          "/operations/requests?box=all&page=1&size=1",
          token,
        )
      ).data.total,
      beforeRequests,
      "模拟不得创建审批申请",
    );
  },
);
