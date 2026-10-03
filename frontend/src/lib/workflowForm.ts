import {
  fieldNames,
  type FieldType,
  type WorkflowField,
  type WorkflowSpec,
} from "../types/workflow";

/** 与 Java WorkflowSchema 共用的字段数量边界；画布布局和预览值不进入发布模型。 */
export const MAX_WORKFLOW_FIELDS = 40;

/** 校验错误始终绑定主字段，明细列错误也能定位到所属明细表的属性面板。 */
export interface WorkflowFieldIssue {
  fieldId: string;
  message: string;
}

const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const DETAIL_FIELD_TYPES = new Set<FieldType>([
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "MONEY",
  "DATE",
  "DATETIME",
  "SINGLE",
]);

function nextFieldId(existing: WorkflowField[]): string {
  const ids = new Set(existing.map((field) => field.id));
  let suffix = 1;
  while (ids.has(`field_${suffix}`)) suffix++;
  return `field_${suffix}`;
}

function requireCapacity(fields: WorkflowField[]): void {
  if (fields.length >= MAX_WORKFLOW_FIELDS)
    throw new Error(
      `表单最多 ${MAX_WORKFLOW_FIELDS} 个字段，请先移除不需要的字段`,
    );
}

/** 不按数组下标推测字段身份；重复 ID 的旧草稿不能安全地选中、复制或删除。 */
function fieldIndex(spec: WorkflowSpec, fieldId: string): number {
  const index = spec.fields.findIndex((field) => field.id === fieldId);
  if (index < 0) throw new Error("表单字段不存在，请重新选择字段");
  if (
    spec.fields.some(
      (field, position) => position !== index && field.id === fieldId,
    )
  )
    throw new Error(`字段 ID“${fieldId}”重复，请先修复字段标识`);
  return index;
}

/**
 * 控件库创建可直接编排的字段，稳定 ID 与中文标题独立。只生成现有 Java 支持的
 * 属性，不替旧草稿补写默认值；新增字段也不自动取得任何审批节点的读写权限。
 */
export function createWorkflowField(
  type: FieldType,
  existing: WorkflowField[],
): WorkflowField {
  requireCapacity(existing);
  if (!Object.hasOwn(fieldNames, type)) throw new Error("不支持的表单控件类型");
  const field: WorkflowField = {
    id: nextFieldId(existing),
    label: fieldNames[type],
    type,
    required: false,
    width:
      type === "TEXTAREA" ||
      type === "DATE_RANGE" ||
      type === "DETAILS" ||
      type === "FILES"
        ? 24
        : 12,
  };
  if (type === "TEXT" || type === "TEXTAREA") field.maxLength = 2000;
  if (type === "MONEY") field.min = 0;
  if (type === "SINGLE" || type === "MULTI") field.options = ["选项1", "选项2"];
  if (type === "DETAILS") {
    field.maxRows = 20;
    // 明细列标识只在当前明细表内唯一，和主字段、其他明细表互不混用。
    field.columns = [
      {
        id: "item",
        label: "项目",
        type: "TEXT",
        required: true,
        maxLength: 2000,
      },
      { id: "amount", label: "金额", type: "MONEY", required: true, min: 0 },
    ];
  }
  return field;
}

/** 在确切插入位置添加控件；首位、字段间及末位使用同一不可变操作，不改变流程连线。 */
export function insertWorkflowField(
  spec: WorkflowSpec,
  index: number,
  type: FieldType,
): WorkflowSpec {
  if (!Number.isInteger(index) || index < 0 || index > spec.fields.length)
    throw new Error("字段插入位置无效，请重新选择位置");
  const field = createWorkflowField(type, spec.fields);
  const result = structuredClone(spec);
  result.fields.splice(index, 0, field);
  return result;
}

/**
 * 将字段移动到目标字段之前；null 表示末尾。使用移除后插入，而非交换两个位置，
 * 因此拖拽跨越多项时，中间字段顺序、字段 ID、条件及节点授权均保持原样。
 */
export function moveWorkflowField(
  spec: WorkflowSpec,
  fieldId: string,
  beforeId: string | null,
): WorkflowSpec {
  const source = fieldIndex(spec, fieldId);
  if (beforeId !== null) fieldIndex(spec, beforeId);
  const result = structuredClone(spec);
  if (beforeId === fieldId) return result;
  const [field] = result.fields.splice(source, 1);
  const target =
    beforeId === null
      ? result.fields.length
      : result.fields.findIndex((candidate) => candidate.id === beforeId);
  result.fields.splice(target, 0, field);
  return result;
}

/**
 * 复制字段紧邻原字段插入，深拷贝选项和明细列，并生成新的主字段 ID。列标识沿用
 * 原来的局部作用域；节点不会自动读取副本，条件也不会从原字段切换到副本。
 */
export function copyWorkflowField(
  spec: WorkflowSpec,
  fieldId: string,
): WorkflowSpec {
  const index = fieldIndex(spec, fieldId);
  requireCapacity(spec.fields);
  const result = structuredClone(spec);
  const copy = structuredClone(spec.fields[index]);
  copy.id = nextFieldId(spec.fields);
  const suffix = "（副本）";
  copy.label = copy.label.slice(0, 60 - suffix.length) + suffix;
  result.fields.splice(index + 1, 0, copy);
  return result;
}

/**
 * 条件仍使用该字段时先阻止删除并指出节点，避免暗改业务路由；普通字段删除只
 * 清理对应读写引用，保留节点、连线、其他字段和历史属性，不修改输入模型。
 */
export function removeWorkflowField(
  spec: WorkflowSpec,
  fieldId: string,
): WorkflowSpec {
  const index = fieldIndex(spec, fieldId);
  const referenced = spec.nodes.filter((node) =>
    node.conditions?.some((condition) => condition.field === fieldId),
  );
  if (referenced.length)
    throw new Error(
      `字段被条件节点“${referenced.map((node) => node.name).join("、")}”使用，请先修改分支条件`,
    );
  const result = structuredClone(spec);
  result.fields.splice(index, 1);
  for (const node of result.nodes) {
    if (node.readable)
      node.readable = node.readable.filter((id) => id !== fieldId);
    if (node.writable)
      node.writable = node.writable.filter((id) => id !== fieldId);
  }
  return result;
}

/**
 * 即时检查与 Java 发布契约一致的字段约束；返回所有可定位错误，不修剪、不补写
 * 默认值，也不替代服务端的发布、表单值、人员或附件归属校验。明细列递用同一
 * 基础检查，但其 ID 仅在当前明细中去重，错误统一绑定所属主字段。
 */
export function validateWorkflowFields(
  fields: WorkflowField[],
): WorkflowFieldIssue[] {
  const issues: WorkflowFieldIssue[] = [];
  if (fields.length > MAX_WORKFLOW_FIELDS)
    issues.push({
      fieldId: fields[MAX_WORKFLOW_FIELDS]?.id ?? "",
      message: `表单最多 ${MAX_WORKFLOW_FIELDS} 个字段`,
    });

  function inspectFields(items: WorkflowField[], parent?: WorkflowField): void {
    const ids = new Set<string>();
    for (const field of items) {
      const ownerId = parent?.id ?? field?.id ?? "";
      const prefix = parent
        ? `明细列“${field?.label || field?.id || "未命名"}”：`
        : "";
      const issue = (message: string) =>
        issues.push({ fieldId: ownerId, message: prefix + message });
      if (!field) {
        issue("字段配置不能为空");
        continue;
      }
      if (typeof field.id !== "string" || !FIELD_ID_PATTERN.test(field.id))
        issue("字段标识须以字母开头，使用字母、数字、下划线，最多 40 个字符");
      if (ids.has(field.id)) issue("字段标识不能重复");
      ids.add(field.id);
      if (
        typeof field.label !== "string" ||
        !field.label.trim() ||
        field.label.length > 60
      )
        issue("字段名称须为 1 至 60 个字符，不能只含空格");
      if (!Object.hasOwn(fieldNames, field.type)) issue("不支持的字段类型");
      if (field.width != null && field.width !== 12 && field.width !== 24)
        issue("字段布局只支持半行或整行");
      if (field.placeholder != null && field.placeholder.length > 200)
        issue("输入提示最多 200 个字符");
      if (field.helpText != null && field.helpText.length > 500)
        issue("填写说明最多 500 个字符");
      if (
        field.maxLength != null &&
        (!Number.isInteger(field.maxLength) ||
          field.maxLength < 1 ||
          field.maxLength > 10000)
      )
        issue("文本最大长度须为 1 至 10000 的整数");
      if (
        (field.min != null && !Number.isFinite(field.min)) ||
        (field.max != null && !Number.isFinite(field.max))
      )
        issue("数值上下限必须是有限数值");
      if (field.min != null && field.max != null && field.min > field.max)
        issue("数值下限不能大于上限");

      if (field.type === "SINGLE" || field.type === "MULTI") {
        if (
          !Array.isArray(field.options) ||
          !field.options.length ||
          field.options.length > 50
        )
          issue("选择项需要 1 至 50 个值");
        if (Array.isArray(field.options)) {
          if (new Set(field.options).size !== field.options.length)
            issue("选择项不能重复");
          if (
            field.options.some(
              (option) =>
                typeof option !== "string" ||
                !option.trim() ||
                option.length > 100,
            )
          )
            issue("每个选择项须为 1 至 100 个字符，不能只含空格");
        }
      }

      if (parent && !DETAIL_FIELD_TYPES.has(field.type))
        issue("明细列仅支持文字、数值、日期时间和单选，不能嵌套明细或附件");
      if (field.type === "DETAILS") {
        if (
          !Array.isArray(field.columns) ||
          !field.columns.length ||
          field.columns.length > 6
        )
          issue("明细表需要 1 至 6 列");
        if (
          field.maxRows != null &&
          (!Number.isInteger(field.maxRows) ||
            field.maxRows < 1 ||
            field.maxRows > 50)
        )
          issue("明细最多行数须为 1 至 50 的整数");
        // 已知不支持嵌套，不递归非法子明细，避免恶意旧草稿触发无限递归。
        if (!parent && Array.isArray(field.columns))
          inspectFields(field.columns, field);
      } else if (
        field.columns != null &&
        (!Array.isArray(field.columns) || field.columns.length)
      )
        issue("只有明细表可以配置子列");
    }
  }

  inspectFields(fields);
  return issues;
}

/**
 * 单选值也是分支规则的真实比较值；重命名或删除选项后，保留原条件并指出关联
 * 节点，避免自动替换值或静默改变业务路由。包含比较仍允许匹配原选项的子串。
 */
export function validateWorkflowFormReferences(
  spec: WorkflowSpec,
): WorkflowFieldIssue[] {
  const issues: WorkflowFieldIssue[] = [];
  for (const node of spec.nodes) {
    if (node.type !== "CONDITION") continue;
    for (const condition of node.conditions ?? []) {
      const field = spec.fields.find((item) => item.id === condition.field);
      if (
        field?.type === "SINGLE" &&
        (condition.operator === "EQ" || condition.operator === "NE") &&
        !field.options?.includes(condition.value)
      )
        issues.push({
          fieldId: field.id,
          message: `条件节点“${node.name}”使用的字段“${field.label}”选项已不存在，请重新配置分支条件`,
        });
    }
  }
  return issues;
}

/** 根据原十进制表示计算 BigDecimal 的精度和 scale，避免浮点取整误放过超限金额。 */
function decimalParts(value: unknown): {
  precision: number;
  scale: number;
  digits: string;
  negative: boolean;
} | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const match =
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const digits = ((match[2] ?? "") + fraction).replace(/^0+/, "") || "0";
  const exponent = Number(match[5] ?? 0);
  const scale = fraction.length - exponent;
  if (
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > 2147483647 ||
    scale < -2147483648 ||
    scale > 2147483647
  )
    return null;
  return {
    precision: digits.length,
    scale,
    digits,
    negative: match[1] === "-" && digits !== "0",
  };
}

/** 十进制字符串比较不丢小数，例如 1000000000000000.01 必须大于精确上限。 */
function compareDecimal(
  left: NonNullable<ReturnType<typeof decimalParts>>,
  right: NonNullable<ReturnType<typeof decimalParts>>,
): number {
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const sign = left.negative ? -1 : 1;
  if (left.digits === "0" || right.digits === "0")
    return left.digits === right.digits
      ? 0
      : (left.digits === "0" ? -1 : 1) * sign;
  const leftMagnitude = left.digits.length - left.scale;
  const rightMagnitude = right.digits.length - right.scale;
  if (leftMagnitude !== rightMagnitude)
    return (leftMagnitude > rightMagnitude ? 1 : -1) * sign;
  const length = Math.max(left.digits.length, right.digits.length);
  const first = left.digits.padEnd(length, "0");
  const second = right.digits.padEnd(length, "0");
  return first === second ? 0 : (first > second ? 1 : -1) * sign;
}

/** ISO 日期不交给 Date 自动进位；2026-02-30、非闰年 02-29 必须明确无效。 */
function calendarDate(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = /^([+-]?\d{4,9})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const yearText = match[1];
  const year = Number(yearText);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 与 ISO LocalDate 的扩展年符号规则一致；0000 也是合法的闰年。
  if (
    Math.abs(year) > 999999999 ||
    (yearText.startsWith("+") && yearText.length <= 5) ||
    (yearText.startsWith("-") && year === 0) ||
    (!/^[+-]/.test(yearText) && yearText.length !== 4)
  )
    return null;
  if (month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1] ? [year, month, day] : null;
}

function calendarDateTime(value: string): boolean {
  const match = /^(.*)[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(
    value,
  );
  return Boolean(
    match &&
    calendarDate(match[1]) &&
    Number(match[2]) <= 23 &&
    Number(match[3]) <= 59 &&
    Number(match[4] ?? 0) <= 59,
  );
}

function isPositiveAssociation(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value);
  if (!/^[+]?\d+$/.test(text)) return false;
  try {
    const id = BigInt(text);
    return id > 0n && id <= 9223372036854775807n;
  } catch {
    return false;
  }
}

/**
 * 填写预览复用 Java 表单语义：必填、类型、精度、真实日历、明细子列和选项逐项
 * 校验。结果只定位字段，不转换或清洗值，不发送模拟/上传请求。关联 ID 的存在、
 * 附件归属和审批访问权只能由实际提交服务确认，前端通过不代表取得业务授权。
 */
export function validateWorkflowFormValues(
  fields: WorkflowField[],
  values: Record<string, unknown>,
): WorkflowFieldIssue[] {
  const issues: WorkflowFieldIssue[] = [];

  function inspectValues(
    items: WorkflowField[],
    raw: Record<string, unknown>,
    parentId?: string,
    rowNumber?: number,
  ): void {
    const ids = new Set(items.map((field) => field.id));
    for (const key of Object.keys(raw))
      if (!ids.has(key))
        issues.push({
          fieldId: parentId ?? key,
          message: `${rowNumber ? `第 ${rowNumber} 行` : "表单"}含未登记字段“${key}”`,
        });

    for (const field of items) {
      // 字段 ID 允许与 Object 原型成员同名。与 Java Map.get 一致，只读取实际提交的键；
      // 缺少 toString、constructor 等字段时不能把继承成员误当作已填写的值。
      const value = Object.hasOwn(raw, field.id) ? raw[field.id] : undefined;
      const label = `${rowNumber ? `第 ${rowNumber} 行，` : ""}${field.label}`;
      const issue = (message: string) =>
        issues.push({
          fieldId: parentId ?? field.id,
          message: label + message,
        });
      const empty =
        value == null ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && value.length === 0);
      if (empty) {
        if (field.required) issue("不能为空");
        continue;
      }

      if (field.type === "DETAILS") {
        if (parentId) {
          issue("不支持嵌套明细");
          continue;
        }
        if (!Array.isArray(value)) {
          issue("必须为明细列表");
          continue;
        }
        if (value.length > (field.maxRows ?? 20)) {
          issue("明细行数超限");
          continue;
        }
        for (const [index, row] of value.entries()) {
          if (
            !row ||
            Object.prototype.toString.call(row) !== "[object Object]"
          ) {
            issue(`第 ${index + 1} 行数据无效`);
            continue;
          }
          inspectValues(
            field.columns ?? [],
            row as Record<string, unknown>,
            field.id,
            index + 1,
          );
        }
      } else if (field.type === "DATE_RANGE") {
        if (!Array.isArray(value) || value.length !== 2) {
          issue("需要完整的起止日期");
          continue;
        }
        const from = calendarDate(value[0]);
        const to = calendarDate(value[1]);
        if (!from || !to) {
          issue("日期区间格式无效，请填写完整的有效日期");
          continue;
        }
        const reversed = from.findIndex((part, index) => part !== to[index]);
        if (reversed >= 0 && from[reversed] > to[reversed])
          issue("结束日期不能早于开始日期");
      } else if (field.type === "NUMBER" || field.type === "MONEY") {
        const number = decimalParts(value);
        if (!number) {
          issue("必须是数值");
          continue;
        }
        if (
          number.precision > 18 ||
          number.scale > (field.type === "MONEY" ? 2 : 6) ||
          compareDecimal(
            { ...number, negative: false },
            decimalParts("1000000000000000")!,
          ) > 0
        )
          issue("精度或大小超出范围");
        const minimum = field.min != null ? decimalParts(field.min) : null;
        const maximum = field.max != null ? decimalParts(field.max) : null;
        if ((field.min != null && !minimum) || (field.max != null && !maximum))
          issue("数值范围配置无效");
        if (
          (minimum && compareDecimal(number, minimum) < 0) ||
          (maximum && compareDecimal(number, maximum) > 0)
        )
          issue("超出允许范围");
      } else if (field.type === "MULTI" || field.type === "FILES") {
        if (!Array.isArray(value)) {
          issue("必须为列表");
          continue;
        }
        if (
          value.length > (field.type === "FILES" ? 8 : 50) ||
          new Set(value).size !== value.length
        )
          issue("数量超限或存在重复");
        if (field.type === "MULTI") {
          if (
            value.some((option) => !field.options?.includes(option as string))
          )
            issue("包含无效选项");
        } else if (value.some((id) => !isPositiveAssociation(id)))
          issue("关联 ID 无效；附件归属仍需实际提交校验");
      } else if (field.type === "USER" || field.type === "DEPARTMENT") {
        if (!isPositiveAssociation(value)) issue("关联 ID 无效");
      } else {
        if (typeof value !== "string") {
          issue("必须为文本");
          continue;
        }
        if (value.length > (field.maxLength ?? 2000)) issue("超过最大长度");
        if (field.type === "SINGLE" && !field.options?.includes(value))
          issue("包含无效选项");
        if (field.type === "DATE" && !calendarDate(value))
          issue("日期格式应为有效的 YYYY-MM-DD");
        if (field.type === "DATETIME" && !calendarDateTime(value))
          issue("日期时间格式无效");
      }
    }
  }

  inspectValues(fields, values);
  return issues;
}
