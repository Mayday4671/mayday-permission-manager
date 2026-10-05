import type { WorkflowField, WorkflowNode } from "../types/workflow";

/** 数值字段可映射金额或普通数值，其余类型必须一致；计算字段只允许作为输入源。 */
export function compatibleWorkflowField(
  source: WorkflowField,
  target: WorkflowField,
): boolean {
  return (
    source.type === target.type ||
    (["NUMBER", "MONEY", "CALCULATED"].includes(source.type) &&
      ["NUMBER", "MONEY"].includes(target.type))
  );
}

/** 节点保存前定位映射错误；固定子版本字段来自只读接口，服务端发布仍独立重验所有规则。 */
export function subprocessMappingIssues(
  binding: NonNullable<WorkflowNode["subprocess"]>,
  parents: WorkflowField[],
  children: WorkflowField[],
  readable: string[],
  writable: string[],
): string[] {
  const issues: string[] = [];
  for (const [targetId, sourceId] of Object.entries(binding.inputs)) {
    const source = parents.find((field) => field.id === sourceId),
      target = children.find((field) => field.id === targetId);
    if (
      !source ||
      !target ||
      target.type === "CALCULATED" ||
      !compatibleWorkflowField(source, target)
    )
      issues.push("输入映射字段不存在或类型不匹配，请重新选择");
    else if (!readable.includes(sourceId))
      issues.push(`输入字段“${source.label}”未开放可读权限`);
  }
  for (const [targetId, sourceId] of Object.entries(binding.outputs)) {
    const source = children.find((field) => field.id === sourceId),
      target = parents.find((field) => field.id === targetId);
    if (
      !source ||
      !target ||
      target.type === "CALCULATED" ||
      !compatibleWorkflowField(source, target)
    )
      issues.push("输出映射字段不存在或类型不匹配，请重新选择");
    else if (!writable.includes(targetId))
      issues.push(`输出字段“${target.label}”未开放可写权限`);
  }
  for (const field of children)
    if (
      field.required &&
      field.type !== "CALCULATED" &&
      !Object.hasOwn(binding.inputs, field.id)
    )
      issues.push(`子流程必填字段“${field.label}”需要输入映射`);
  return issues;
}
