import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWorkflowValues,
  calculationIssues,
} from "../src/lib/workflowCalculations";
import {
  removeWorkflowField,
  validateWorkflowFormValues,
} from "../src/lib/workflowForm";
import {
  initialSpec,
  type WorkflowField,
  type WorkflowFormula,
} from "../src/types/workflow";

/** 使用与 Java 相同的真实十进制样本，对比精度、顺序、依赖与明细语义。 */
function number(id: string): WorkflowField {
  return { id, label: id, type: "NUMBER" };
}
function calculation(
  id: string,
  operation: WorkflowFormula["operation"],
  operands: string[],
  scale = 2,
  column?: string,
): WorkflowField {
  return {
    id,
    label: id,
    type: "CALCULATED",
    required: true,
    formula: { operation, operands, scale, column },
  };
}

test("按依赖顺序精确计算小数，忽略伪造值并保留传入映射", () => {
  const fields = [
    calculation("gross", "MULTIPLY", ["sum", "quantity"]),
    calculation("sum", "SUM", ["first", "second"]),
    number("first"),
    number("second"),
    number("quantity"),
  ];
  const input = { first: "0.10", second: "0.20", quantity: 3, sum: 8888 };
  assert.deepEqual(calculateWorkflowValues(fields, input), {
    values: { gross: "0.90", sum: "0.30" },
    issues: [],
  });
  assert.equal(input.sum, 8888);
  assert.deepEqual(validateWorkflowFormValues(fields, input), []);
});
test("明细汇总、日期含起止两天和跨闰年结果一致", () => {
  const fields: WorkflowField[] = [
    {
      id: "items",
      label: "费用",
      type: "DETAILS",
      columns: [{ id: "amount", label: "金额", type: "MONEY" }],
    },
    { id: "period", label: "时间", type: "DATE_RANGE" },
    calculation("total", "DETAIL_SUM", ["items"], 2, "amount"),
    calculation("days", "DATE_DAYS", ["period"], 0),
  ];
  assert.deepEqual(
    calculateWorkflowValues(fields, {
      items: [{ amount: "19.95" }, { amount: "0.05" }],
      period: ["2024-02-28", "2024-03-01"],
    }).values,
    { total: "20.00", days: "3" },
  );
  assert.deepEqual(
    calculateWorkflowValues(fields, {
      items: [],
      period: ["2026-02-30", "2026-03-01"],
    }).values,
    { total: null, days: null },
  );
});
test("负数四舍五入、减法顺序、零除与缺项不伪造有效结果", () => {
  const fields = [
    number("first"),
    number("second"),
    calculation("difference", "SUBTRACT", ["first", "second"], 3),
    calculation("quotient", "DIVIDE", ["first", "second"]),
  ];
  assert.deepEqual(
    calculateWorkflowValues(fields, { first: "-1.005", second: 1 }).values,
    { difference: "-2.005", quotient: "-1.01" },
  );
  assert.match(
    calculateWorkflowValues(fields, { first: 1, second: 0 }).issues[0].message,
    /除数/,
  );
  assert.equal(
    calculateWorkflowValues(fields, { first: 1 }).values.quotient,
    null,
  );
});
test("设计器阻止计算环、失效列、错误来源和删除被引用字段", () => {
  assert.match(
    calculationIssues([
      calculation("a", "SUM", ["b"]),
      calculation("b", "SUM", ["a"]),
    ])[0].message,
    /循环/,
  );
  assert.match(
    calculationIssues([calculation("a", "SUM", ["missing"])])[0].message,
    /不存在/,
  );
  assert.match(
    calculationIssues([
      { id: "memo", label: "说明", type: "TEXT" },
      calculation("a", "SUM", ["memo"]),
    ])[0].message,
    /来源/,
  );
  const spec = initialSpec();
  spec.fields = [number("first"), calculation("total", "SUM", ["first"])];
  assert.throws(() => removeWorkflowField(spec, "first"), /计算字段/);
  assert.equal(spec.fields.length, 2);
});
