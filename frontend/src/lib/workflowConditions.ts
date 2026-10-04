import type {
  WorkflowCondition,
  WorkflowConditionRule,
  WorkflowField,
} from "../types/workflow";

/** 遍历先限制形状、深度及总数，保存检查和字段引用保护共用；无效模型不能静默走默认路线。 */
export function conditionLeaves(
  condition: WorkflowCondition,
): WorkflowConditionRule[] {
  if (!condition.predicate)
    return [
      {
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
      },
    ];
  if (
    condition.field != null ||
    condition.operator != null ||
    condition.value != null
  )
    throw new Error("组合条件不能同时配置旧单条件");
  const leaves: WorkflowConditionRule[] = [];
  function visit(rule: WorkflowConditionRule, depth: number): void {
    if (!rule || depth > 3) throw new Error("组合条件最多嵌套 3 层分组");
    if (rule.logic != null) {
      if (
        !["AND", "OR"].includes(rule.logic) ||
        rule.field != null ||
        rule.operator != null ||
        rule.value != null
      )
        throw new Error("条件分组只能设置全部满足或任一满足");
      if (
        !Array.isArray(rule.children) ||
        !rule.children.length ||
        rule.children.length > 20
      )
        throw new Error("条件分组需要 1 至 20 条判断");
      rule.children.forEach((child) => visit(child, depth + 1));
    } else {
      if (rule.children?.length) throw new Error("单条件不能包含子条件");
      leaves.push(rule);
      if (leaves.length > 20) throw new Error("一个分支最多 20 条判断");
    }
  }
  visit(condition.predicate, 0);
  return leaves;
}

/** 属性弹窗在保存前定位非法字段、类型和比较值，发布仍由 Java 完整校验。 */
export function conditionIssues(
  condition: WorkflowCondition,
  fields: WorkflowField[],
): string[] {
  let leaves: WorkflowConditionRule[];
  try {
    leaves = conditionLeaves(condition);
  } catch (error) {
    return [(error as Error).message];
  }
  const issues: string[] = [];
  for (const [index, rule] of leaves.entries()) {
    const prefix = `第 ${index + 1} 条判断：`;
    const field = fields.find((field) => field.id === rule.field);
    if (
      !field ||
      ![
        "TEXT",
        "TEXTAREA",
        "NUMBER",
        "MONEY",
        "CALCULATED",
        "DATE",
        "DATETIME",
        "SINGLE",
      ].includes(field.type)
    ) {
      issues.push(prefix + "请选择有效的表单字段");
      continue;
    }
    const numeric = ["NUMBER", "MONEY", "CALCULATED"].includes(field.type);
    if (
      !rule.operator ||
      !["EQ", "NE", "GT", "GE", "LT", "LE", "CONTAINS"].includes(rule.operator)
    )
      issues.push(prefix + "请选择比较方式");
    if (!numeric && ["GT", "GE", "LT", "LE"].includes(rule.operator ?? ""))
      issues.push(prefix + "大小比较只适用于数值字段");
    if (
      typeof rule.value !== "string" ||
      rule.value.length > 1000 ||
      !rule.value.length
    )
      issues.push(prefix + "请填写比较值，最多 1000 字");
    else if (
      numeric &&
      rule.operator !== "CONTAINS" &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rule.value)
    )
      issues.push(prefix + "请输入有效数字");
    else if (
      field.type === "SINGLE" &&
      ["EQ", "NE"].includes(rule.operator ?? "") &&
      !field.options?.includes(rule.value)
    )
      issues.push(
        prefix + `字段“${field.label}”选项已不存在，请重新配置分支条件`,
      );
  }
  return issues;
}

/** 画布摘要只显示规则个数和组合关系，完整值仍在节点弹窗查看，避免卡片长文本溢出。 */
export function conditionSummary(
  condition: WorkflowCondition,
): string | undefined {
  if (!condition.predicate) return undefined;
  try {
    const count = conditionLeaves(condition).length;
    return `${condition.predicate.logic === "OR" ? "任一满足" : "全部满足"} · ${count} 条判断`;
  } catch {
    return "请修复组合条件";
  }
}
