import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkflowBranch,
  deleteWorkflowBranch,
  findWorkflowConditionJoin,
  insertWorkflowNode,
  insertWorkflowNodeAfterBranches,
  listWorkflowEdges,
  MAX_WORKFLOW_BRANCHES,
  MAX_WORKFLOW_NODES,
  moveWorkflowBranch,
  removeWorkflowNode,
} from "../src/lib/workflowGraph";
import {
  initialSpec,
  type WorkflowNode,
  type WorkflowSpec,
} from "../src/types/workflow";

function model(nodes: WorkflowNode[], startNodeId = nodes[0].id): WorkflowSpec {
  return { ...initialSpec(), nodes, startNodeId };
}

function approval(id: string, next: string): WorkflowNode {
  return { id, name: id, type: "APPROVAL", next };
}

function condition(id: string, next: string, branches: string[]): WorkflowNode {
  return {
    id,
    name: id,
    type: "CONDITION",
    next,
    conditions: branches.map((target, index) => ({
      field: "amount",
      operator: "EQ",
      value: String(index),
      next: target,
    })),
  };
}

function node(spec: WorkflowSpec, id: string): WorkflowNode {
  const found = spec.nodes.find((item) => item.id === id);
  assert.ok(found, `应保留节点 ${id}`);
  return found;
}

const end: WorkflowNode = { id: "end", name: "结束", type: "END" };

test("入口线上添加节点自动更新起点，审批与抄送权限具有明确默认值", () => {
  const source = initialSpec();
  const original = structuredClone(source);
  const updated = insertWorkflowNode(
    source,
    { sourceId: null, branchIndex: null, targetId: "review" },
    "COPY",
  );
  assert.equal(updated.startNodeId, "copy_1");
  assert.equal(node(updated, "copy_1").next, "review");
  assert.deepEqual(node(updated, "copy_1").readable, ["description"]);
  assert.deepEqual(node(updated, "copy_1").writable, []);
  assert.deepEqual(node(updated, "copy_1").actions, []);
  assert.deepEqual(node(updated, "copy_1").assigneeIds, []);
  const withApproval = insertWorkflowNode(
    updated,
    { sourceId: "copy_1", branchIndex: null, targetId: "review" },
    "APPROVAL",
  );
  assert.equal(node(withApproval, "copy_1").next, "approval_1");
  assert.equal(node(withApproval, "approval_1").mode, "ALL");
  assert.deepEqual(node(withApproval, "approval_1").actions, [
    "APPROVE",
    "REJECT",
    "RETURN",
    "COMMENT",
  ]);
  assert.deepEqual(source, original);
  node(updated, "copy_1").readable!.push("new-field");
  assert.deepEqual(node(withApproval, "copy_1").readable, ["description"]);
});

test("同一目标的多个规则按准确下标插入，默认分支不会被顺带修改", () => {
  const source = model([condition("choice", "end", ["end", "end"]), end]);
  const updated = insertWorkflowNode(
    source,
    { sourceId: "choice", branchIndex: 1, targetId: "end" },
    "APPROVAL",
  );
  assert.deepEqual(
    node(updated, "choice").conditions!.map((branch) => branch.next),
    ["end", "approval_1"],
  );
  assert.equal(node(updated, "choice").next, "end");
  assert.equal(node(updated, "approval_1").next, "end");
  assert.equal(listWorkflowEdges(source).length, 4);
  assert.deepEqual(listWorkflowEdges(source).slice(1), [
    { sourceId: "choice", branchIndex: null, targetId: "end" },
    { sourceId: "choice", branchIndex: 0, targetId: "end" },
    { sourceId: "choice", branchIndex: 1, targetId: "end" },
  ]);
});

test("默认分支可独立插入条件组，显式规则和原始模型保持不变", () => {
  const source = model([condition("choice", "end", ["end", "end"]), end]);
  const updated = insertWorkflowNode(
    source,
    { sourceId: "choice", branchIndex: null, targetId: "end" },
    "CONDITION",
  );
  assert.equal(node(updated, "choice").next, "condition_1");
  assert.ok(
    node(updated, "choice").conditions!.every((rule) => rule.next === "end"),
  );
  assert.deepEqual(node(updated, "condition_1"), {
    id: "condition_1",
    name: "条件分支",
    type: "CONDITION",
    next: "end",
    conditions: [{ field: "", operator: "EQ", value: "", next: "end" }],
  });
  assert.equal(node(source, "choice").next, "end");
  assert.equal(findWorkflowConditionJoin(updated, "choice"), "end");
  assert.equal(findWorkflowConditionJoin(updated, "condition_1"), "end");
});

test("删除普通共享节点旁路所有入线，删除起点自动回接，结束节点不可删除", () => {
  const source = model([
    condition("choice", "shared", ["shared", "first"]),
    approval("first", "shared"),
    approval("shared", "end"),
    end,
  ]);
  const updated = removeWorkflowNode(source, "shared");
  assert.equal(node(updated, "choice").next, "end");
  assert.deepEqual(
    node(updated, "choice").conditions!.map((rule) => rule.next),
    ["end", "first"],
  );
  assert.equal(node(updated, "first").next, "end");
  assert.equal(node(source, "first").next, "shared");
  const rootDeleted = removeWorkflowNode(updated, "choice");
  assert.equal(rootDeleted.startNodeId, "end");
  assert.deepEqual(
    rootDeleted.nodes.map((item) => item.id),
    ["end"],
  );
  assert.throws(() => removeWorkflowNode(source, "end"), /结束节点不能删除/);
});

test("删除条件组仅删除专属分支，保留默认路径、共享后继及不相关的孤立旧节点", () => {
  const source = model([
    condition("choice", "fallback", ["exclusive", "shared"]),
    approval("fallback", "shared"),
    approval("exclusive", "exclusive_tail"),
    approval("exclusive_tail", "shared"),
    approval("shared", "end"),
    approval("legacy", "legacy_end"),
    { id: "legacy_end", name: "旧草稿结束", type: "END" },
    end,
  ]);
  const original = structuredClone(source);
  const updated = removeWorkflowNode(source, "choice");
  assert.equal(updated.startNodeId, "fallback");
  assert.deepEqual(
    updated.nodes.map((item) => item.id),
    ["fallback", "shared", "legacy", "legacy_end", "end"],
  );
  assert.deepEqual(source, original);
});

test("分支外旧节点仍指向共享节点时，删除分支不会误删该节点及其后续链路", () => {
  const source = model([
    condition("choice", "fallback", ["exclusive", "fallback"]),
    approval("fallback", "end"),
    approval("exclusive", "shared"),
    approval("shared", "end"),
    approval("legacy", "shared"),
    end,
  ]);
  const updated = deleteWorkflowBranch(source, "choice", 0);
  assert.ok(!updated.nodes.some((item) => item.id === "exclusive"));
  assert.equal(node(updated, "legacy").next, "shared");
  assert.equal(node(updated, "shared").next, "end");
  assert.equal(node(updated, "choice").conditions!.length, 1);
});

test("共享目标的规则能独立排序和删除，添加规则始终使用默认后继", () => {
  const source = model([
    condition("choice", "end", ["shared", "shared"]),
    approval("shared", "end"),
    end,
  ]);
  const reordered = moveWorkflowBranch(source, "choice", 0, 1);
  assert.deepEqual(
    node(reordered, "choice").conditions!.map((rule) => rule.value),
    ["1", "0"],
  );
  assert.equal(node(reordered, "choice").next, "end");
  const deleted = deleteWorkflowBranch(reordered, "choice", 0);
  assert.equal(node(deleted, "choice").conditions![0].value, "0");
  assert.equal(node(deleted, "shared").next, "end");
  assert.throws(
    () => deleteWorkflowBranch(deleted, "choice", 0),
    /至少保留一条规则/,
  );
  const added = addWorkflowBranch(deleted, "choice");
  assert.deepEqual(node(added, "choice").conditions![1], {
    field: "",
    operator: "EQ",
    value: "",
    next: "end",
  });
  assert.deepEqual(
    node(source, "choice").conditions!.map((rule) => rule.value),
    ["0", "1"],
  );
});

test("嵌套条件的汇合点取最近的共享节点，空分支能够在组后一次插入共享审批", () => {
  const source = model([
    condition("outer", "fallback", ["inner"]),
    condition("inner", "branch_b", ["branch_a"]),
    approval("branch_a", "inner_join"),
    approval("branch_b", "inner_join"),
    approval("inner_join", "shared"),
    approval("fallback", "shared"),
    approval("shared", "end"),
    end,
  ]);
  assert.equal(findWorkflowConditionJoin(source, "inner"), "inner_join");
  assert.equal(findWorkflowConditionJoin(source, "outer"), "shared");
  const emptyBranches = model([condition("empty", "end", ["end", "end"]), end]);
  const updated = insertWorkflowNodeAfterBranches(
    emptyBranches,
    "empty",
    "APPROVAL",
  );
  assert.equal(node(updated, "empty").next, "approval_1");
  assert.ok(
    node(updated, "empty").conditions!.every(
      (rule) => rule.next === "approval_1",
    ),
  );
  assert.equal(node(updated, "approval_1").next, "end");
  assert.equal(node(emptyBranches, "empty").next, "end");
});

test("条件组后插入共享节点覆盖内部及嵌套出口，分支外的独立入线原样保留", () => {
  const source = model([
    condition("outer", "fallback", ["inner", "shared"]),
    condition("inner", "shared", ["branch_a"]),
    approval("branch_a", "shared"),
    approval("fallback", "shared"),
    approval("outside", "shared"),
    approval("shared", "end"),
    end,
  ]);
  const original = structuredClone(source);
  const updated = insertWorkflowNodeAfterBranches(source, "outer", "COPY");
  assert.equal(node(updated, "outer").conditions![1].next, "copy_1");
  assert.equal(node(updated, "inner").next, "copy_1");
  assert.equal(node(updated, "branch_a").next, "copy_1");
  assert.equal(node(updated, "fallback").next, "copy_1");
  assert.equal(node(updated, "outside").next, "shared");
  assert.equal(node(updated, "copy_1").next, "shared");
  assert.equal(node(updated, "shared").next, "end");
  assert.deepEqual(source, original);
});

test("多次编辑仅分配未使用的 ID，不重写已有 ID；超出节点和规则上限时拒绝", () => {
  const source = model([
    approval("approval_1", "approval_3"),
    approval("approval_3", "end"),
    end,
  ]);
  const updated = insertWorkflowNode(
    source,
    { sourceId: "approval_1", branchIndex: null, targetId: "approval_3" },
    "APPROVAL",
  );
  assert.equal(node(updated, "approval_1").next, "approval_2");
  assert.equal(node(updated, "approval_2").next, "approval_3");
  assert.equal(node(updated, "approval_3").next, "end");
  const full = model([
    ...Array.from({ length: MAX_WORKFLOW_NODES - 1 }, (_, index) =>
      approval(
        `node_${index}`,
        index === MAX_WORKFLOW_NODES - 2 ? "end" : `node_${index + 1}`,
      ),
    ),
    end,
  ]);
  assert.throws(
    () =>
      insertWorkflowNode(
        full,
        { sourceId: null, branchIndex: null, targetId: "node_0" },
        "COPY",
      ),
    /最多 40 个节点/,
  );
  const allBranches = model([
    condition(
      "choice",
      "end",
      Array.from({ length: MAX_WORKFLOW_BRANCHES }, () => "end"),
    ),
    end,
  ]);
  assert.throws(
    () => addWorkflowBranch(allBranches, "choice"),
    /最多 10 条规则/,
  );
});

test("过期连接、规则下标和缺失目标不能误改其他出口；循环图编辑安全失败", () => {
  const source = model([condition("choice", "end", ["end", "end"]), end]);
  assert.throws(
    () =>
      insertWorkflowNode(
        source,
        { sourceId: "choice", branchIndex: 2, targetId: "end" },
        "COPY",
      ),
    /条件分支不存在/,
  );
  assert.throws(
    () =>
      insertWorkflowNode(
        source,
        { sourceId: null, branchIndex: 0, targetId: "choice" },
        "COPY",
      ),
    /流程入口已变化/,
  );
  assert.throws(
    () => moveWorkflowBranch(source, "choice", 0.5, 0),
    /条件分支不存在/,
  );
  assert.throws(
    () =>
      insertWorkflowNode(
        source,
        { sourceId: "end", branchIndex: null, targetId: "choice" },
        "COPY",
      ),
    /起点不存在或已经结束/,
  );
  const cycle = model([
    condition("choice", "end", ["loop"]),
    approval("loop", "choice"),
    end,
  ]);
  assert.equal(findWorkflowConditionJoin(cycle, "choice"), null);
  assert.throws(() => removeWorkflowNode(cycle, "choice"), /存在循环/);
  assert.throws(() => addWorkflowBranch(cycle, "choice"), /存在循环/);
  assert.throws(
    () => insertWorkflowNodeAfterBranches(cycle, "choice", "COPY"),
    /存在循环/,
  );
  const dangling = model([condition("choice", "end", ["missing"]), end]);
  assert.equal(findWorkflowConditionJoin(dangling, "choice"), null);
  assert.throws(() => removeWorkflowNode(dangling, "choice"), /后继不存在/);
});

test("没有公共后继的分支不能自动在条件组之后接线", () => {
  const source = model([
    condition("choice", "end", ["other_end"]),
    { id: "other_end", name: "其他结束", type: "END" },
    end,
  ]);
  assert.equal(findWorkflowConditionJoin(source, "choice"), null);
  assert.throws(
    () => insertWorkflowNodeAfterBranches(source, "choice", "APPROVAL"),
    /没有公共汇合节点/,
  );
});

test("仅公共可达但存在提前结束的路径时，组后添加不能让部分路径跳过新节点", () => {
  const source = model([
    condition("outer", "shared", ["inner"]),
    condition("inner", "shared", ["early_end"]),
    approval("shared", "end"),
    { id: "early_end", name: "提前结束", type: "END" },
    end,
  ]);
  assert.equal(findWorkflowConditionJoin(source, "outer"), null);
  assert.throws(
    () => insertWorkflowNodeAfterBranches(source, "outer", "COPY"),
    /没有公共汇合节点/,
  );
  assert.equal(node(source, "outer").next, "shared");
});

test("嵌套分支跳过较近的可达节点时，汇合点使用所有路径必经的后继", () => {
  const source = model([
    condition("outer", "shared", ["inner"]),
    condition("inner", "shared", ["end"]),
    approval("shared", "end"),
    end,
  ]);
  assert.equal(findWorkflowConditionJoin(source, "outer"), "end");
  assert.equal(findWorkflowConditionJoin(source, "inner"), "end");
  const updated = insertWorkflowNodeAfterBranches(source, "outer", "COPY");
  assert.equal(node(updated, "inner").conditions![0].next, "copy_1");
  assert.equal(node(updated, "shared").next, "copy_1");
  assert.equal(node(updated, "copy_1").next, "end");
});

test("删除嵌套条件所在分支清理整个专属子树，并保留汇合节点和其他规则", () => {
  const source = model([
    condition("outer", "fallback", ["inner", "fallback"]),
    condition("inner", "inner_b", ["inner_a"]),
    approval("inner_a", "inner_join"),
    approval("inner_b", "inner_join"),
    approval("inner_join", "shared"),
    approval("fallback", "shared"),
    approval("shared", "end"),
    approval("legacy", "end"),
    end,
  ]);
  const updated = deleteWorkflowBranch(source, "outer", 0);
  assert.deepEqual(
    updated.nodes.map((item) => item.id),
    ["outer", "fallback", "shared", "legacy", "end"],
  );
  assert.equal(node(updated, "outer").conditions![0].next, "fallback");
  assert.equal(findWorkflowConditionJoin(updated, "outer"), "fallback");
});

test("历史结束节点的旧 next 不构成真实出口，缺失目标及回指不会阻止安全编辑", () => {
  const source = model([
    condition("choice", "end", ["end"]),
    { ...end, next: "choice" },
    { id: "old_end", name: "旧结束", type: "END", next: "missing" },
  ]);
  assert.equal(findWorkflowConditionJoin(source, "choice"), "end");
  assert.equal(listWorkflowEdges(source).length, 3);
  const updated = insertWorkflowNodeAfterBranches(source, "choice", "COPY");
  assert.equal(node(updated, "copy_1").next, "end");
  assert.equal(node(updated, "end").next, "choice");
  assert.equal(node(updated, "old_end").next, "missing");
  assert.equal(node(source, "choice").next, "end");
});

test("未引用且不是起点的孤立结束节点可删除，其他结束节点的旧 next 不算入线", () => {
  const source = model([
    approval("review", "end"),
    { ...end, next: "old_end" },
    { id: "old_end", name: "旧结束", type: "END", next: "review" },
    approval("legacy", "end"),
  ]);
  const original = structuredClone(source);
  const updated = removeWorkflowNode(source, "old_end");
  assert.deepEqual(
    updated.nodes.map((item) => item.id),
    ["review", "end", "legacy"],
  );
  assert.equal(updated.startNodeId, "review");
  assert.equal(node(updated, "review").next, "end");
  assert.deepEqual(source, original);
});

test("起点和任意真实分支引用的结束节点受保护，孤立审批节点的引用也不能悬空", () => {
  assert.throws(
    () => removeWorkflowNode(model([end]), "end"),
    /结束节点不能删除/,
  );
  const branched = model([
    condition("choice", "end", ["other_end"]),
    { id: "other_end", name: "分支结束", type: "END" },
    end,
  ]);
  assert.throws(
    () => removeWorkflowNode(branched, "other_end"),
    /结束节点不能删除/,
  );
  const isolatedIncoming = model([
    approval("review", "end"),
    approval("legacy", "old_end"),
    { id: "old_end", name: "旧结束", type: "END" },
    end,
  ]);
  assert.throws(
    () => removeWorkflowNode(isolatedIncoming, "old_end"),
    /结束节点不能删除/,
  );
});

test("删除分支时结束节点的旧出口不会错误保护本应清理的分支专属节点", () => {
  const source = model([
    condition("choice", "fallback", ["exclusive", "fallback"]),
    approval("exclusive", "end"),
    approval("fallback", "end"),
    { ...end, next: "exclusive" },
  ]);
  const updated = deleteWorkflowBranch(source, "choice", 0);
  assert.ok(!updated.nodes.some((item) => item.id === "exclusive"));
  assert.equal(node(updated, "fallback").next, "end");
  assert.equal(node(updated, "end").next, "exclusive");
});
