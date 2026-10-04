import type { WorkflowField } from "../types/workflow";
import type { WorkflowFieldIssue } from "./workflowForm";

/** 前端预览与 Java 相同的白名单，十进制使用整数分数计算，避免 0.1 + 0.2 的浮点误差。 */
export const calculationNames = {
  SUM: "求和",
  SUBTRACT: "相减",
  MULTIPLY: "相乘",
  DIVIDE: "相除",
  DETAIL_SUM: "明细列汇总",
  DATE_DAYS: "日期区间天数",
};
const numericTypes = new Set(["NUMBER", "MONEY", "CALCULATED"]);

/** 设计时指出不存在、类型不匹配及环状引用；不替用户更换字段或修改运算顺序。 */
export function calculationIssues(
  fields: WorkflowField[],
): WorkflowFieldIssue[] {
  const issues: WorkflowFieldIssue[] = [];
  const catalog = new Map(fields.map((field) => [field.id, field]));
  for (const field of fields) {
    const formula = field.formula;
    const error = (message: string) =>
      issues.push({ fieldId: field.id, message: `${field.label}：${message}` });
    if (field.type !== "CALCULATED") {
      if (formula != null) error("只有计算字段可以设置计算规则");
      continue;
    }
    if (!formula) {
      error("需要配置计算规则");
      continue;
    }
    if (!Object.hasOwn(calculationNames, formula.operation))
      error("计算方式无效");
    if (
      !Number.isInteger(formula.scale) ||
      formula.scale < 0 ||
      formula.scale > 6
    )
      error("计算精度应为 0 至 6 位");
    if (
      !Array.isArray(formula.operands) ||
      !formula.operands.length ||
      formula.operands.length > 10 ||
      new Set(formula.operands).size !== formula.operands.length
    ) {
      error("需要 1 至 10 个不重复来源字段");
      continue;
    }
    if (formula.operands.some((id) => !catalog.has(id))) {
      error("引用的来源字段已不存在");
      continue;
    }
    if (
      ["SUBTRACT", "DIVIDE"].includes(formula.operation) &&
      formula.operands.length !== 2
    )
      error("减法和除法需要两个字段");
    if (formula.operation === "DETAIL_SUM") {
      const source = catalog.get(formula.operands[0]);
      if (
        formula.operands.length !== 1 ||
        source?.type !== "DETAILS" ||
        !source.columns?.some(
          (column) =>
            column.id === formula.column &&
            ["NUMBER", "MONEY"].includes(column.type),
        )
      )
        error("请选择明细表及其中的数字或金额列");
    } else if (formula.operation === "DATE_DAYS") {
      if (
        formula.operands.length !== 1 ||
        catalog.get(formula.operands[0])?.type !== "DATE_RANGE"
      )
        error("请选择一个日期区间");
      if (formula.scale !== 0) error("日期天数精度应为 0");
    } else if (
      formula.operands.some((id) => !numericTypes.has(catalog.get(id)!.type))
    )
      error("来源必须为数字、金额或计算字段");
    if (formula.operation !== "DETAIL_SUM" && formula.column != null)
      error("只有明细汇总可以设置列");
  }
  const done = new Set<string>();
  function visit(id: string, visiting: Set<string>): void {
    const field = catalog.get(id);
    if (!field?.formula || field.type !== "CALCULATED" || done.has(id)) return;
    if (visiting.has(id)) {
      issues.push({
        fieldId: id,
        message: `${field.label}：计算字段存在循环引用`,
      });
      return;
    }
    visiting.add(id);
    for (const source of field.formula.operands ?? []) visit(source, visiting);
    visiting.delete(id);
    done.add(id);
  }
  fields.forEach((field) => visit(field.id, new Set()));
  return issues;
}

interface Decimal {
  numerator: bigint;
  denominator: bigint;
}
function decimal(raw: unknown): Decimal | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const text = String(raw);
  if (text.length > 50) return null;
  const match =
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);
  if (
    !Number.isInteger(exponent) ||
    Math.abs(exponent) > 18 ||
    fraction.length > 18
  )
    return null;
  const power = fraction.length - exponent;
  const numerator =
    BigInt((match[2] ?? "0") + fraction) * (match[1] === "-" ? -1n : 1n);
  return {
    numerator: numerator * 10n ** BigInt(Math.max(0, -power)),
    denominator: 10n ** BigInt(Math.max(0, power)),
  };
}
function add(left: Decimal, right: Decimal): Decimal {
  return {
    numerator:
      left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}
function rounded(value: Decimal, scale: number): string {
  let numerator = value.numerator * 10n ** BigInt(scale),
    denominator = value.denominator;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const integer =
    absolute / denominator +
    ((absolute % denominator) * 2n >= denominator ? 1n : 0n);
  const digits = integer.toString().padStart(scale + 1, "0");
  return (
    (negative && integer !== 0n ? "-" : "") +
    (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits)
  );
}
/** 日历差值独立于浏览器时区和夏令时；校验日期不允许 Date 自动进位。 */
function calendarDay(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^([+-]?\d{4,9})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > months[month - 1])
    return null;
  const previous = year - 1;
  return (
    previous * 365 +
    Math.floor(previous / 4) -
    Math.floor(previous / 100) +
    Math.floor(previous / 400) +
    months.slice(0, month - 1).reduce((total, days) => total + days, 0) +
    day
  );
}

/** 仅返回计算字段的即时预览。输入暂缺返回空值，非法规则返回可定位错误；提交由 Java 再次精确重算。 */
export function calculateWorkflowValues(
  fields: WorkflowField[],
  raw: Record<string, unknown>,
): { values: Record<string, string | null>; issues: WorkflowFieldIssue[] } {
  const issues = calculationIssues(fields);
  const values: Record<string, string | null> = {};
  const catalog = new Map(fields.map((field) => [field.id, field]));
  const invalid = new Set(issues.map((issue) => issue.fieldId));
  function compute(field: WorkflowField): unknown {
    if (field.type !== "CALCULATED")
      return Object.hasOwn(raw, field.id) ? raw[field.id] : null;
    if (Object.hasOwn(values, field.id)) return values[field.id];
    values[field.id] = null;
    if (invalid.has(field.id) || !field.formula) return null;
    const formula = field.formula;
    const sources = formula.operands.map((id) => compute(catalog.get(id)!));
    if (
      sources.some(
        (value) =>
          value == null ||
          (typeof value === "string" && !value.trim()) ||
          (Array.isArray(value) && !value.length),
      )
    )
      return null;
    let result: Decimal | null = null;
    if (formula.operation === "DATE_DAYS") {
      const range = sources[0];
      if (Array.isArray(range) && range.length === 2) {
        const from = calendarDay(range[0]),
          to = calendarDay(range[1]);
        if (from !== null && to !== null && to >= from)
          result = { numerator: BigInt(to - from + 1), denominator: 1n };
      }
    } else if (formula.operation === "DETAIL_SUM") {
      if (Array.isArray(sources[0])) {
        result = { numerator: 0n, denominator: 1n };
        for (const row of sources[0]) {
          const cell =
            row && typeof row === "object"
              ? decimal((row as Record<string, unknown>)[formula.column!])
              : null;
          if (!cell) {
            result = null;
            break;
          }
          result = add(result, cell);
        }
      }
    } else {
      const numbers = sources.map(decimal);
      if (numbers.every((value): value is Decimal => value !== null)) {
        if (formula.operation === "SUM")
          result = numbers.reduce(add, { numerator: 0n, denominator: 1n });
        if (formula.operation === "SUBTRACT")
          result = add(numbers[0], {
            ...numbers[1],
            numerator: -numbers[1].numerator,
          });
        if (formula.operation === "MULTIPLY")
          result = numbers.reduce(
            (left, right) => ({
              numerator: left.numerator * right.numerator,
              denominator: left.denominator * right.denominator,
            }),
            { numerator: 1n, denominator: 1n },
          );
        if (formula.operation === "DIVIDE") {
          if (numbers[1].numerator === 0n)
            issues.push({
              fieldId: field.id,
              message: `${field.label}：除数不能为 0`,
            });
          else
            result = {
              numerator: numbers[0].numerator * numbers[1].denominator,
              denominator: numbers[0].denominator * numbers[1].numerator,
            };
        }
      }
    }
    if (result) values[field.id] = rounded(result, formula.scale);
    return values[field.id];
  }
  fields.filter((field) => field.type === "CALCULATED").forEach(compute);
  return { values, issues };
}
