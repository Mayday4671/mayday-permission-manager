import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkflowBranch,
  deleteWorkflowBranch,
  findWorkflowConditionJoin,
  insertWorkflowNode,
  insertWorkflowNodeAfterBranches,
  listWorkflowEdges,
  removeWorkflowNode,
} from "../src/lib/workflowGraph";
import { initialSpec } from "../src/types/workflow";
import {
  removeWorkflowField,
  validateWorkflowFormReferences,
} from "../src/lib/workflowForm";
import { subprocessMappingIssues } from "../src/lib/workflowSubprocess";

/** 图形操作必须产生可执行的专属汇合结构，不能只画两条线；旧条件编排仍按原连接保留。 */
test("并行插入自动建立两条审批支路和专属汇合，入口没有默认捷径", () => {
  const before = initialSpec();
  const after = insertWorkflowNode(
    before,
    { sourceId: null, branchIndex: null, targetId: before.startNodeId },
    "PARALLEL",
  );
  const fork = after.nodes.find((node) => node.id === after.startNodeId)!;
  assert.equal(fork.type, "PARALLEL");
  assert.equal(fork.branches?.length, 2);
  const join = after.nodes.find((node) => node.id === fork.next)!;
  assert.equal(join.type, "JOIN");
  assert.equal(join.next, before.startNodeId);
  assert.equal(findWorkflowConditionJoin(after, fork.id), join.id);
  assert.deepEqual(
    listWorkflowEdges(after)
      .filter((edge) => edge.sourceId === fork.id)
      .map((edge) => edge.branchIndex),
    [0, 1],
  );
  assert.equal(before.nodes.length, 2, "原模型不被原地改写");
});
test("并行增删支路只删除专属节点，始终保留两条和原共享后续", () => {
  const before = initialSpec();
  let model = insertWorkflowNode(
    before,
    { sourceId: null, branchIndex: null, targetId: before.startNodeId },
    "PARALLEL",
  );
  const forkId = model.startNodeId,
    joinId = model.nodes.find((node) => node.id === forkId)!.next!;
  model = addWorkflowBranch(model, forkId);
  const removedId = model.nodes.find((node) => node.id === forkId)!
    .branches![2];
  model = deleteWorkflowBranch(model, forkId, 2);
  assert(!model.nodes.some((node) => node.id === removedId));
  assert(model.nodes.some((node) => node.id === joinId));
  assert.throws(() => deleteWorkflowBranch(model, forkId, 0), /两条/);
  assert.throws(() => removeWorkflowNode(model, joinId), /并行组/);
  model = removeWorkflowNode(model, forkId);
  assert.equal(model.startNodeId, before.startNodeId);
  assert.deepEqual(
    model.nodes.map((node) => node.id),
    before.nodes.map((node) => node.id),
  );
});
test("汇合后插入子流程不改变支路的汇合目标，固定版本尚未选择不能伪发布", () => {
  const before = initialSpec();
  let model = insertWorkflowNode(
    before,
    { sourceId: null, branchIndex: null, targetId: before.startNodeId },
    "PARALLEL",
  );
  const forkId = model.startNodeId,
    fork = model.nodes.find((node) => node.id === forkId)!;
  model = insertWorkflowNodeAfterBranches(model, forkId, "SUBPROCESS");
  const child = model.nodes.find((node) => node.type === "SUBPROCESS")!;
  assert.equal(child.subprocess?.versionId, null);
  assert.equal(child.next, before.startNodeId);
  assert.equal(
    model.nodes.find((node) => node.id === fork.next)?.next,
    child.id,
  );
  assert(
    fork.branches?.every(
      (id) => model.nodes.find((node) => node.id === id)!.next === fork.next,
    ),
  );
});
test("并行支路线路准确插入另一并行组或子流程，其他入口保持不变", () => {
  const before = initialSpec();
  let model = insertWorkflowNode(
    before,
    { sourceId: null, branchIndex: null, targetId: before.startNodeId },
    "PARALLEL",
  );
  const fork = model.nodes.find((node) => node.id === model.startNodeId)!;
  const other = fork.branches![1];
  model = insertWorkflowNode(
    model,
    { sourceId: fork.id, branchIndex: 0, targetId: fork.branches![0] },
    "SUBPROCESS",
  );
  assert.equal(
    model.nodes.find((node) => node.id === fork.id)!.branches![1],
    other,
  );
  const child = model.nodes.find((node) => node.type === "SUBPROCESS")!;
  assert.equal(child.next, fork.branches![0]);
});
test("条件组汇合后插入并行必须生成完整四节点，外部入线不会被挪走", () => {
  const before = initialSpec();
  before.nodes.unshift({
    id: "choice",
    name: "条件",
    type: "CONDITION",
    next: "review",
    conditions: [{ field: "memo", operator: "EQ", value: "A", next: "review" }],
  });
  before.startNodeId = "choice";
  const after = insertWorkflowNodeAfterBranches(before, "choice", "PARALLEL");
  const fork = after.nodes.find((node) => node.type === "PARALLEL")!;
  assert.equal(fork.branches?.length, 2);
  assert.equal(
    after.nodes.find((node) => node.id === fork.next)?.next,
    "review",
  );
  const condition = after.nodes.find((node) => node.id === "choice")!;
  assert.equal(condition.next, fork.id);
  assert.equal(condition.conditions![0].next, fork.id);
  assert.equal(after.nodes.length, before.nodes.length + 4);
});
test("子流程映射字段不允许静默删除，旧草稿失效映射可定位", () => {
  const before = initialSpec(),
    fieldId = before.fields[0].id;
  before.nodes.unshift({
    id: "child",
    name: "子申请",
    type: "SUBPROCESS",
    next: "review",
    subprocess: { versionId: 1, inputs: { childMemo: fieldId }, outputs: {} },
  });
  before.startNodeId = "child";
  assert.throws(() => removeWorkflowField(before, fieldId), /子流程.*映射/);
  before.nodes[0].subprocess!.inputs.childMemo = "missing";
  assert(
    validateWorkflowFormReferences(before).some(
      (issue) => issue.fieldId === "missing",
    ),
  );
});
test("子映射保存即时校验必填、父读写范围和数值类型兼容", () => {
  const parent = [
    { id: "text", label: "文本", type: "TEXT" as const },
    { id: "amount", label: "金额", type: "MONEY" as const },
  ];
  const child = [
    { id: "memo", label: "说明", type: "TEXT" as const, required: true },
    { id: "result", label: "结果", type: "NUMBER" as const },
  ];
  const binding = {
    versionId: 1,
    inputs: { memo: "text" },
    outputs: { amount: "result" },
  };
  assert.deepEqual(
    subprocessMappingIssues(binding, parent, child, ["text"], ["amount"]),
    [],
  );
  assert(
    subprocessMappingIssues(
      { ...binding, inputs: {} },
      parent,
      child,
      ["text"],
      ["amount"],
    ).some((message) => message.includes("必填")),
  );
  assert(
    subprocessMappingIssues(binding, parent, child, [], ["amount"]).some(
      (message) => message.includes("可读"),
    ),
  );
  assert(
    subprocessMappingIssues(binding, parent, child, ["text"], []).some(
      (message) => message.includes("可写"),
    ),
  );
  assert(
    subprocessMappingIssues(
      { ...binding, inputs: { memo: "amount" } },
      parent,
      child,
      ["amount"],
      ["amount"],
    ).some((message) => message.includes("类型")),
  );
});
