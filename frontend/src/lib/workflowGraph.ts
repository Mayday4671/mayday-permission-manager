import type {
  WorkflowCondition,
  WorkflowNode,
  WorkflowSpec,
} from "../types/workflow";

/**
 * 画布中的确切出口。sourceId 为 null 表示申请人的入口线；branchIndex 为
 * null 表示普通后继或条件节点的默认分支，数字则对应条件规则的数组下标。
 * 即使多个出口指向同一节点，也必须用出口位置区分，不能只按目标 ID 修改。
 */
export interface WorkflowEdge {
  sourceId: string | null;
  branchIndex: number | null;
  targetId: string;
}

export type InsertableWorkflowNode = "APPROVAL" | "COPY" | "CONDITION";

/** 与服务端 WorkflowSchema 的发布限制一致，编辑器提前阻止超限操作。 */
export const MAX_WORKFLOW_NODES = 40;
export const MAX_WORKFLOW_BRANCHES = 10;

type NodeMap = Map<string, WorkflowNode>;

function targets(node: WorkflowNode): string[] {
  // 服务端在 END 立即停止；历史表单可能留有旧 next，不能把它当作真实出口。
  if (node.type === "END") return [];
  return [
    ...(node.next ? [node.next] : []),
    ...(node.type === "CONDITION"
      ? (node.conditions ?? []).map((condition) => condition.next)
      : []),
  ];
}

/**
 * 只验证编辑所依赖的结构，不代替发布校验。未配置审批人、未填完条件规则和
 * 旧草稿的孤立节点仍可编辑；重复 ID、缺失目标和循环则会使自动接线不安全。
 */
function inspectGraph(spec: WorkflowSpec): NodeMap {
  if (spec.nodes.length > MAX_WORKFLOW_NODES)
    throw new Error(`流程最多 ${MAX_WORKFLOW_NODES} 个节点`);
  const nodes: NodeMap = new Map();
  for (const node of spec.nodes) {
    if (!node.id || nodes.has(node.id))
      throw new Error("流程节点 ID 为空或重复，请先修复节点配置");
    nodes.set(node.id, node);
  }
  if (!nodes.has(spec.startNodeId))
    throw new Error("流程起点不存在，请先修复起点配置");

  for (const node of spec.nodes) {
    for (const target of targets(node)) {
      if (!nodes.has(target))
        throw new Error(`节点“${node.name}”的后继不存在，请先修复连接`);
    }
  }

  // 三色深度遍历仅用于结构保护；最多 40 个节点，遇到回边立即中止。
  const visiting = new Set<string>();
  const finished = new Set<string>();
  function visit(id: string): void {
    if (finished.has(id)) return;
    if (visiting.has(id))
      throw new Error("流程存在循环，无法安全自动接线，请先修复连接");
    visiting.add(id);
    for (const target of targets(nodes.get(id)!)) visit(target);
    visiting.delete(id);
    finished.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  return nodes;
}

function getCondition(nodes: NodeMap, id: string): WorkflowNode {
  const node = nodes.get(id);
  if (!node || node.type !== "CONDITION")
    throw new Error("条件节点不存在，请刷新流程后再操作");
  return node;
}

function requireBranchIndex(node: WorkflowNode, index: number): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= (node.conditions?.length ?? 0)
  )
    throw new Error("条件分支不存在，请刷新流程后再操作");
}

function newNodeId(spec: WorkflowSpec, type: InsertableWorkflowNode): string {
  const ids = new Set(spec.nodes.map((node) => node.id));
  const prefix = type.toLowerCase();
  let suffix = 1;
  while (ids.has(`${prefix}_${suffix}`)) suffix++;
  return `${prefix}_${suffix}`;
}

function newNode(
  spec: WorkflowSpec,
  type: InsertableWorkflowNode,
  next: string,
): WorkflowNode {
  const id = newNodeId(spec, type);
  if (type === "CONDITION")
    return {
      id,
      name: "条件分支",
      type,
      next,
      // 显式规则与默认分支各有一条连接；未填完的规则由发布校验拦截。
      conditions: [{ field: "", operator: "EQ", value: "", next }],
    };
  return {
    id,
    name: type === "APPROVAL" ? "审批人" : "抄送人",
    type,
    next,
    source: "USERS",
    assigneeIds: [],
    mode: type === "APPROVAL" ? "ALL" : "ANY",
    readable: spec.fields.map((field) => field.id),
    writable: [],
    actions:
      type === "APPROVAL" ? ["APPROVE", "REJECT", "RETURN", "COMMENT"] : [],
    conditions: [],
  };
}

function replaceExactEdge(
  spec: WorkflowSpec,
  edge: WorkflowEdge,
  replacement: string,
): void {
  if (edge.sourceId === null) {
    if (edge.branchIndex !== null || spec.startNodeId !== edge.targetId)
      throw new Error("流程入口已变化，请刷新后再添加节点");
    spec.startNodeId = replacement;
    return;
  }
  const source = spec.nodes.find((node) => node.id === edge.sourceId);
  if (!source || source.type === "END")
    throw new Error("该连接的起点不存在或已经结束，请刷新流程");
  if (edge.branchIndex === null) {
    if (source.next !== edge.targetId)
      throw new Error("流程连接已变化，请刷新后再添加节点");
    source.next = replacement;
    return;
  }
  if (source.type !== "CONDITION")
    throw new Error("只有条件节点能够添加规则分支");
  requireBranchIndex(source, edge.branchIndex);
  const branch = source.conditions![edge.branchIndex];
  if (branch.next !== edge.targetId)
    throw new Error("条件分支已变化，请刷新后再添加节点");
  branch.next = replacement;
}

function reachable(nodes: NodeMap, roots: Iterable<string>): Set<string> {
  const visited = new Set<string>();
  const pending = Array.from(roots);
  while (pending.length) {
    const id = pending.pop()!;
    const node = nodes.get(id);
    if (!node || visited.has(id)) continue;
    visited.add(id);
    pending.push(...targets(node));
  }
  return visited;
}

/**
 * 删除分支仅清理该分支原本能够到达、删除后失去全部保留入口的节点。
 * 以分支外所有旧节点作为保护入口，保留共享汇合节点、结束节点以及不相关的
 * 孤立草稿；不能用“从起点全图清理”误删用户尚未连接的历史节点。
 */
function pruneRemovedBranch(
  before: NodeMap,
  after: WorkflowSpec,
  removedRoots: string[],
): void {
  const candidates = reachable(before, removedRoots);
  const remaining: NodeMap = new Map(
    after.nodes.map((node) => [node.id, node]),
  );
  const keepRoots = [
    after.startNodeId,
    ...after.nodes
      .filter((node) => !candidates.has(node.id) || node.type === "END")
      .map((node) => node.id),
  ];
  const retained = reachable(remaining, keepRoots);
  after.nodes = after.nodes.filter(
    (node) => !candidates.has(node.id) || retained.has(node.id),
  );
}

/**
 * 枚举申请人入口、普通后继以及每一条条件规则的独立出口，用于在线上放置
 * “添加节点”控件。相同目标的多个规则仍返回多个出口，保留准确的规则下标。
 */
export function listWorkflowEdges(spec: WorkflowSpec): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [
    { sourceId: null, branchIndex: null, targetId: spec.startNodeId },
  ];
  for (const node of spec.nodes) {
    if (node.type === "END") continue;
    if (node.next)
      edges.push({ sourceId: node.id, branchIndex: null, targetId: node.next });
    if (node.type === "CONDITION")
      (node.conditions ?? []).forEach((branch, branchIndex) => {
        edges.push({ sourceId: node.id, branchIndex, targetId: branch.next });
      });
  }
  return edges;
}

/**
 * 在用户点击的确切连接线上插入审批人、抄送人或条件分支，自动保留原有后继。
 * 返回独立草稿，不修改传入模型；条件规则先留空，由用户配置后才能发布。
 */
export function insertWorkflowNode(
  spec: WorkflowSpec,
  edge: WorkflowEdge,
  type: InsertableWorkflowNode,
): WorkflowSpec {
  const nodes = inspectGraph(spec);
  if (spec.nodes.length >= MAX_WORKFLOW_NODES)
    throw new Error(`流程最多 ${MAX_WORKFLOW_NODES} 个节点`);
  if (!nodes.has(edge.targetId))
    throw new Error("该连接的目标不存在，请刷新流程");
  const updated = structuredClone(spec);
  const inserted = newNode(updated, type, edge.targetId);
  replaceExactEdge(updated, edge, inserted.id);
  // 保留原有节点顺序，新节点放在目标之前，列表视图也能反映插入位置。
  const targetIndex = updated.nodes.findIndex(
    (node) => node.id === edge.targetId,
  );
  updated.nodes.splice(targetIndex, 0, inserted);
  return updated;
}

/**
 * 在整个条件组汇合后插入一个共享节点，而不是只改默认分支。遍历在公共
 * 汇合点之前截止，仅改该条件及其内部节点指向汇合点的出口；来自其他流程
 * 路径的入线保持不变。无公共汇合处时拒绝自动接线，由用户先修复流程结构。
 */
export function insertWorkflowNodeAfterBranches(
  spec: WorkflowSpec,
  conditionId: string,
  type: InsertableWorkflowNode,
): WorkflowSpec {
  const nodes = inspectGraph(spec);
  const condition = getCondition(nodes, conditionId);
  if (spec.nodes.length >= MAX_WORKFLOW_NODES)
    throw new Error(`流程最多 ${MAX_WORKFLOW_NODES} 个节点`);
  const joinId = findWorkflowConditionJoin(spec, conditionId);
  if (!joinId)
    throw new Error("条件分支没有公共汇合节点，无法在分支之后自动添加节点");

  // 公共节点之后的路径不属于本次条件组，不能随遍历扩散到外部入线。
  const members = new Set<string>([conditionId]);
  const pending = targets(condition);
  while (pending.length) {
    const id = pending.pop()!;
    if (id === joinId || members.has(id)) continue;
    const member = nodes.get(id)!;
    if (member.type === "END" || targets(member).length === 0)
      throw new Error(
        "部分条件路径未经过公共汇合节点，无法在分支之后自动添加节点",
      );
    members.add(id);
    pending.push(...targets(member));
  }

  const updated = structuredClone(spec);
  const inserted = newNode(updated, type, joinId);
  for (const node of updated.nodes) {
    if (!members.has(node.id)) continue;
    if (node.next === joinId) node.next = inserted.id;
    if (node.type === "CONDITION") {
      for (const branch of node.conditions ?? []) {
        if (branch.next === joinId) branch.next = inserted.id;
      }
    }
  }
  const joinIndex = updated.nodes.findIndex((node) => node.id === joinId);
  updated.nodes.splice(joinIndex, 0, inserted);
  return updated;
}

/**
 * 删除普通节点后将所有入线接回其后继；删除条件节点时保留默认分支，并清理
 * 仅属于被移除规则的节点。正在使用的结束节点不可删除；没有真实入线、且
 * 不是起点的孤立结束节点允许单独删除，供用户修复旧草稿，不顺带清理其他节点。
 */
export function removeWorkflowNode(
  spec: WorkflowSpec,
  nodeId: string,
): WorkflowSpec {
  const nodes = inspectGraph(spec);
  const removed = nodes.get(nodeId);
  if (!removed) throw new Error("流程节点不存在，请刷新流程");
  if (removed.type === "END") {
    const hasIncoming = spec.nodes.some((node) =>
      targets(node).includes(nodeId),
    );
    if (spec.startNodeId === nodeId || hasIncoming)
      throw new Error("正在使用的结束节点不能删除");
    const updated = structuredClone(spec);
    updated.nodes = updated.nodes.filter((node) => node.id !== nodeId);
    return updated;
  }
  if (!removed.next)
    throw new Error("该节点没有有效后继，无法自动连接，请先修复连接");
  const updated = structuredClone(spec);
  if (updated.startNodeId === nodeId) updated.startNodeId = removed.next;
  for (const node of updated.nodes) {
    if (node.type === "END") continue;
    if (node.next === nodeId) node.next = removed.next;
    if (node.type === "CONDITION") {
      for (const branch of node.conditions ?? []) {
        if (branch.next === nodeId) branch.next = removed.next;
      }
    }
  }
  updated.nodes = updated.nodes.filter((node) => node.id !== nodeId);
  if (removed.type === "CONDITION")
    pruneRemovedBranch(
      nodes,
      updated,
      (removed.conditions ?? []).map((branch) => branch.next),
    );
  return updated;
}

/**
 * 在默认分支前追加一条待配置规则，初始接到默认后继。规则优先级由数组顺序
 * 决定，默认出口始终作为最后的兜底路径，不参与普通规则排序。
 */
export function addWorkflowBranch(
  spec: WorkflowSpec,
  conditionId: string,
): WorkflowSpec {
  const node = getCondition(inspectGraph(spec), conditionId);
  if (!node.next) throw new Error("条件节点缺少默认出口，请先修复默认分支");
  if ((node.conditions?.length ?? 0) >= MAX_WORKFLOW_BRANCHES)
    throw new Error(`条件节点最多 ${MAX_WORKFLOW_BRANCHES} 条规则`);
  const updated = structuredClone(spec);
  const condition = updated.nodes.find((item) => item.id === conditionId)!;
  const branch: WorkflowCondition = {
    field: "",
    operator: "EQ",
    value: "",
    next: node.next,
  };
  condition.conditions = [...(condition.conditions ?? []), branch];
  return updated;
}

/**
 * 按确切规则下标删除分支，保留至少一条显式规则及默认出口。被删除分支的
 * 专属节点随之清理，其他规则指向相同目标时该目标及其后续链路继续保留。
 */
export function deleteWorkflowBranch(
  spec: WorkflowSpec,
  conditionId: string,
  branchIndex: number,
): WorkflowSpec {
  const nodes = inspectGraph(spec);
  const node = getCondition(nodes, conditionId);
  requireBranchIndex(node, branchIndex);
  if (node.conditions!.length <= 1)
    throw new Error("条件分支至少保留一条规则；若无需条件，请删除条件节点");
  const removedTarget = node.conditions![branchIndex].next;
  const updated = structuredClone(spec);
  const condition = updated.nodes.find((item) => item.id === conditionId)!;
  condition.conditions!.splice(branchIndex, 1);
  pruneRemovedBranch(nodes, updated, [removedTarget]);
  return updated;
}

/**
 * 调整显式规则的匹配优先级；使用原数组的确切下标，目标相同的不同规则仍
 * 能独立排序。默认出口保持不变，节点配置、字段权限和节点 ID 均原样保留。
 */
export function moveWorkflowBranch(
  spec: WorkflowSpec,
  conditionId: string,
  fromIndex: number,
  toIndex: number,
): WorkflowSpec {
  const node = getCondition(inspectGraph(spec), conditionId);
  requireBranchIndex(node, fromIndex);
  requireBranchIndex(node, toIndex);
  const updated = structuredClone(spec);
  const condition = updated.nodes.find((item) => item.id === conditionId)!;
  const [moved] = condition.conditions!.splice(fromIndex, 1);
  condition.conditions!.splice(toIndex, 0, moved);
  return updated;
}

function distances(nodes: NodeMap, root: string): Map<string, number> {
  const result = new Map<string, number>([[root, 0]]);
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of targets(nodes.get(id)!)) {
      if (result.has(target)) continue;
      result.set(target, result.get(id)! + 1);
      queue.push(target);
    }
  }
  return result;
}

function allPathsLeadTo(
  nodes: NodeMap,
  roots: string[],
  target: string,
): boolean {
  const answers = new Map<string, boolean>();
  function reaches(id: string): boolean {
    if (id === target) return true;
    const known = answers.get(id);
    if (known !== undefined) return known;
    const node = nodes.get(id)!;
    const outgoing = targets(node);
    if (node.type === "END" || outgoing.length === 0) {
      answers.set(id, false);
      return false;
    }
    const result = outgoing.every(reaches);
    answers.set(id, result);
    return result;
  }
  return roots.every(reaches);
}

/**
 * 查找条件节点各出口最近的安全汇合点：各出口的所有后续路径都必须经过该
 * 节点，不能把“可能到达”画成“必然汇合”。优先保留图中靠前的公共节点，
 * 再以最长距离、总距离和原节点顺序稳定择优；嵌套分支和相同目标均可识别。
 * 提前结束、损坏连接或循环没有安全汇合点时返回 null，避免误画和无限遍历。
 */
export function findWorkflowConditionJoin(
  spec: WorkflowSpec,
  conditionId: string,
): string | null {
  let nodes: NodeMap;
  try {
    nodes = inspectGraph(spec);
  } catch {
    return null;
  }
  const condition = nodes.get(conditionId);
  if (!condition || condition.type !== "CONDITION") return null;
  const roots = [...new Set(targets(condition))];
  if (roots.length === 0) return null;
  const paths = roots.map((root) => distances(nodes, root));
  const common = spec.nodes
    .map((node) => node.id)
    .filter(
      (id) =>
        paths.every((path) => path.has(id)) && allPathsLeadTo(nodes, roots, id),
    );
  if (!common.length) return null;

  // 排除已经位于另一个公共节点之后的候选，防止捷径把结束节点排到真正汇合处前面。
  const downstream = new Map(
    common.map((id) => [id, reachable(nodes, targets(nodes.get(id)!))]),
  );
  const nearest = common.filter(
    (id) =>
      !common.some((other) => other !== id && downstream.get(other)!.has(id)),
  );
  nearest.sort((left, right) => {
    const leftDistances = paths.map((path) => path.get(left)!);
    const rightDistances = paths.map((path) => path.get(right)!);
    return (
      Math.max(...leftDistances) - Math.max(...rightDistances) ||
      leftDistances.reduce((sum, value) => sum + value, 0) -
        rightDistances.reduce((sum, value) => sum + value, 0) ||
      common.indexOf(left) - common.indexOf(right)
    );
  });
  return nearest[0] ?? null;
}
