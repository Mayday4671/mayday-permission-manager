import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionIssues,
  conditionLeaves,
  conditionSummary,
} from "../src/lib/workflowConditions";
import {
  removeWorkflowField,
  validateWorkflowFormReferences,
} from "../src/lib/workflowForm";
import {
  initialSpec,
  type WorkflowCondition,
  type WorkflowConditionRule,
  type WorkflowField,
} from "../src/types/workflow";

const fields: WorkflowField[] = [
  { id: "amount", label: "金额", type: "MONEY" },
  { id: "kind", label: "类型", type: "SINGLE", options: ["采购", "差旅"] },
];
/** 条件树用稳定字段引用，模板测试不改业务数据。 */
function grouped(): WorkflowCondition {
  return {
    next: "end",
    predicate: {
      logic: "AND",
      children: [
        { field: "amount", operator: "GT", value: "1000" },
        {
          logic: "OR",
          children: [
            { field: "kind", operator: "EQ", value: "采购" },
            { field: "kind", operator: "EQ", value: "差旅" },
          ],
        },
      ],
    },
  };
}
test("嵌套关系与三条字段引用完整保留，摘要不会挤满画布卡片", () => {
  const rule = grouped();
  const original = structuredClone(rule);
  assert.equal(conditionLeaves(rule).length, 3);
  assert.equal(conditionSummary(rule), "全部满足 · 3 条判断");
  assert.deepEqual(conditionIssues(rule, fields), []);
  assert.deepEqual(rule, original);
});
test("字段删除与选项改名在嵌套组中一样受保护", () => {
  const spec = initialSpec();
  spec.fields = fields;
  spec.nodes.push({
    id: "choice",
    name: "费用审批",
    type: "CONDITION",
    conditions: [grouped()],
    next: "end",
  });
  assert.throws(() => removeWorkflowField(spec, "kind"), /条件节点/);
  assert.deepEqual(validateWorkflowFormReferences(spec), []);
  spec.fields = [{ ...fields[0] }, { ...fields[1], options: ["差旅"] }];
  assert.match(validateWorkflowFormReferences(spec)[0].message, /选项已不存在/);
  assert.match(conditionIssues(grouped(), spec.fields)[0], /选项已不存在/);
});
test("数量、深度、空分组与混合单双表示被明确拒绝", () => {
  const leaf: WorkflowConditionRule = {
    field: "amount",
    operator: "EQ",
    value: "1000",
  };
  assert.throws(
    () =>
      conditionLeaves({
        next: "end",
        predicate: {
          logic: "OR",
          children: Array.from({ length: 21 }, () => leaf),
        },
      }),
    /20/,
  );
  let deep = leaf;
  for (let level = 0; level < 4; level++)
    deep = { logic: "AND", children: [deep] };
  assert.throws(
    () => conditionLeaves({ next: "end", predicate: deep }),
    /3 层/,
  );
  assert.throws(
    () =>
      conditionLeaves({
        next: "end",
        predicate: { logic: "AND", children: [] },
      }),
    /1 至 20/,
  );
  assert.throws(() => conditionLeaves({ ...grouped(), field: "kind" }), /同时/);
});
test("旧单条件没有新增分组，数字比较与未知字段依旧验证", () => {
  const legacy: WorkflowCondition = {
    field: "kind",
    operator: "EQ",
    value: "差旅",
    next: "end",
  };
  assert.deepEqual(conditionIssues(legacy, fields), []);
  assert.equal(conditionSummary(legacy), undefined);
  assert.match(
    conditionIssues({ ...legacy, operator: "GT" }, fields)[0],
    /数值/,
  );
  assert.match(
    conditionIssues(
      { field: "amount", operator: "EQ", value: "invalid", next: "end" },
      fields,
    )[0],
    /有效数字/,
  );
});
