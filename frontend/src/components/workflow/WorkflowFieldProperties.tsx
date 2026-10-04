import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  fieldNames,
  type FieldType,
  type WorkflowField,
} from "../../types/workflow";
import { calculationNames } from "../../lib/workflowCalculations";

const detailColumnTypes: FieldType[] = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "MONEY",
  "DATE",
  "DATETIME",
  "SINGLE",
];

interface FieldSettingsProps {
  field: WorkflowField;
  editable: boolean;
  onChange: (field: WorkflowField) => void;
  column?: boolean;
}

/** 选项值就是发布契约中的值，不能按显示需要 trim、去重或过滤空值。 */
function optionError(value: string, values: string[]): string | undefined {
  if (!value.trim()) return "选项不能为空";
  if (value.length > 100) return "选项最多 100 个字符";
  if (values.filter((option) => option === value).length > 1)
    return "选项不能重复";
  return undefined;
}

/**
 * 行标识只用于保持输入 DOM 稳定，不写入业务 schema。
 * 同一输入框每输入一个字都更新父草稿；不能使用选项值作为 React key，避免失焦。
 * 用户排序时行标识跟随该项移动，外部撤销或切换字段也不会改写真实选项值。
 */
function ChoiceOptions({
  options,
  editable,
  onChange,
}: {
  options: string[];
  editable: boolean;
  onChange: (options: string[]) => void;
}) {
  const sequence = useRef(0);
  const rows = useRef<{ values: string[]; keys: number[] }>({
    values: [],
    keys: [],
  });
  const sameValues =
    rows.current.values.length === options.length &&
    rows.current.values.every((value, index) => value === options[index]);
  if (!sameValues) {
    const previous = rows.current;
    const remaining = previous.keys.map((key, index) => ({
      key,
      value: previous.values[index],
    }));
    rows.current = {
      values: [...options],
      keys:
        previous.keys.length === options.length
          ? previous.keys
          : options.map((value) => {
              const index = remaining.findIndex((item) => item.value === value);
              if (index >= 0) return remaining.splice(index, 1)[0].key;
              return ++sequence.current;
            }),
    };
  }

  function update(values: string[], keys = rows.current.keys) {
    if (!editable) return;
    rows.current = { values, keys };
    onChange(values);
  }

  function move(index: number, target: number) {
    if (!editable || target < 0 || target >= options.length) return;
    const values = [...options];
    const keys = [...rows.current.keys];
    values.splice(target, 0, values.splice(index, 1)[0]);
    keys.splice(target, 0, keys.splice(index, 1)[0]);
    update(values, keys);
  }

  return (
    <div className="workflow-field-options" aria-label="选项设置">
      <Typography.Text strong>选项</Typography.Text>
      {options.map((value, index) => {
        const error = optionError(value, options);
        return (
          <div key={rows.current.keys[index]}>
            <Space.Compact
              block
              className="workflow-field-option-row"
              style={{ marginTop: 8 }}
            >
              <Input
                value={value}
                aria-label={`选项 ${index + 1}`}
                aria-invalid={!!error}
                status={error ? "error" : undefined}
                disabled={!editable}
                onChange={(event) => {
                  const values = [...options];
                  values[index] = event.target.value;
                  update(values);
                }}
              />
              <Button
                aria-label={`上移选项 ${index + 1}`}
                disabled={!editable || index === 0}
                icon={<ArrowUp size={14} />}
                onClick={() => move(index, index - 1)}
              />
              <Button
                aria-label={`下移选项 ${index + 1}`}
                disabled={!editable || index === options.length - 1}
                icon={<ArrowDown size={14} />}
                onClick={() => move(index, index + 1)}
              />
              <Button
                danger
                aria-label={`删除选项 ${index + 1}`}
                disabled={!editable}
                icon={<Trash2 size={14} />}
                onClick={() =>
                  update(
                    options.filter((_, itemIndex) => itemIndex !== index),
                    rows.current.keys.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  )
                }
              />
            </Space.Compact>
            {error && (
              <Typography.Text type="danger" role="alert">
                第 {index + 1} 项：{error}
              </Typography.Text>
            )}
          </div>
        );
      })}
      {(options.length === 0 || options.length > 50) && (
        <div>
          <Typography.Text type="danger" role="alert">
            需要 1 至 50 个选项
          </Typography.Text>
        </div>
      )}
      <Button
        block
        type="dashed"
        icon={<Plus size={14} />}
        style={{ marginTop: 12 }}
        disabled={!editable || options.length >= 50}
        onClick={() => {
          if (!editable || options.length >= 50) return;
          let number = 1;
          while (options.includes(`选项${number}`)) number++;
          update(
            [...options, `选项${number}`],
            [...rows.current.keys, ++sequence.current],
          );
        }}
      >
        添加选项
      </Button>
    </div>
  );
}

/**
 * 属性直接更新父草稿，不另建 Form store 或整体 reset，保证逐字编辑时持续聚焦。
 * patch 基于原字段展开，未编辑的旧属性及扩展属性完整保留；标识、类型不提供入口。
 * 暂时无效的名称、范围和选项只提示，不截断修改；发布时仍由 Java 完整校验。
 */
function FieldSettings({
  field,
  editable,
  onChange,
  column = false,
}: FieldSettingsProps) {
  // 窄屏弹窗关闭后仍保留 DOM；实例级标识避免与桌面属性或另一个明细面板的 label 串联。
  // useId 在当前组件生命周期内稳定，不使用业务字段 ID，也不因逐字更新草稿重新生成。
  const propertyId = `workflow-property-${useId()}`;
  function update(patch: Partial<WorkflowField>) {
    if (editable) onChange({ ...field, ...patch });
  }
  const labelError = !field.label.trim()
    ? "标题不能为空"
    : field.label.length > 60
      ? "标题最多 60 个字符"
      : undefined;
  // Java 旧模型的可空数值表示未配置：判断时兼容 null，但编辑其他属性时不归一化旧值。
  const rangeError =
    field.min != null && field.max != null && field.min > field.max
      ? "最小值不能大于最大值"
      : undefined;
  const lengthError =
    field.maxLength != null &&
    (!Number.isInteger(field.maxLength) ||
      field.maxLength < 1 ||
      field.maxLength > 10000)
      ? "最大长度应为 1 至 10000 的整数"
      : undefined;

  return (
    <Form component="div" layout="vertical" disabled={!editable}>
      <Form.Item
        label={column ? "列标题" : "字段标题"}
        htmlFor={`${propertyId}-label`}
        validateStatus={labelError ? "error" : undefined}
        help={labelError}
      >
        <Input
          id={`${propertyId}-label`}
          value={field.label}
          aria-invalid={!!labelError}
          onChange={(event) => update({ label: event.target.value })}
        />
      </Form.Item>
      <Form.Item label="必填">
        <Switch
          aria-label={column ? "明细列必填" : "字段必填"}
          checked={!!field.required}
          onChange={(required) => update({ required })}
        />
      </Form.Item>
      {!column && (
        <Form.Item label="占用宽度">
          <Segmented
            block
            aria-label="字段占用宽度"
            value={field.width ?? 24}
            options={[
              { value: 12, label: "半行" },
              { value: 24, label: "整行" },
            ]}
            onChange={(width) => update({ width: width as 12 | 24 })}
          />
        </Form.Item>
      )}
      <Form.Item
        label="输入提示"
        htmlFor={`${propertyId}-placeholder`}
        validateStatus={
          (field.placeholder?.length ?? 0) > 200 ? "error" : undefined
        }
        help={
          (field.placeholder?.length ?? 0) > 200
            ? "输入提示最多 200 个字符"
            : undefined
        }
      >
        <Input
          id={`${propertyId}-placeholder`}
          value={field.placeholder ?? ""}
          onChange={(event) => update({ placeholder: event.target.value })}
        />
      </Form.Item>
      <Form.Item
        label="填写说明"
        htmlFor={`${propertyId}-help`}
        validateStatus={
          (field.helpText?.length ?? 0) > 500 ? "error" : undefined
        }
        help={
          (field.helpText?.length ?? 0) > 500
            ? "填写说明最多 500 个字符"
            : undefined
        }
      >
        <Input.TextArea
          id={`${propertyId}-help`}
          rows={2}
          value={field.helpText ?? ""}
          onChange={(event) => update({ helpText: event.target.value })}
        />
      </Form.Item>
      {(field.type === "TEXT" || field.type === "TEXTAREA") && (
        <Form.Item
          label="最大长度"
          htmlFor={`${propertyId}-length`}
          validateStatus={lengthError ? "error" : undefined}
          help={lengthError}
        >
          <InputNumber
            id={`${propertyId}-length`}
            style={{ width: "100%" }}
            value={field.maxLength}
            onChange={(maxLength) =>
              update({ maxLength: maxLength ?? undefined })
            }
          />
        </Form.Item>
      )}
      {(field.type === "NUMBER" ||
        field.type === "MONEY" ||
        field.type === "CALCULATED") && (
        <>
          <div className="form-two-columns">
            <Form.Item
              label="最小值"
              htmlFor={`${propertyId}-min`}
              validateStatus={rangeError ? "error" : undefined}
            >
              <InputNumber
                id={`${propertyId}-min`}
                style={{ width: "100%" }}
                value={field.min}
                onChange={(min) => update({ min: min ?? undefined })}
              />
            </Form.Item>
            <Form.Item
              label="最大值"
              htmlFor={`${propertyId}-max`}
              validateStatus={rangeError ? "error" : undefined}
            >
              <InputNumber
                id={`${propertyId}-max`}
                style={{ width: "100%" }}
                value={field.max}
                onChange={(max) => update({ max: max ?? undefined })}
              />
            </Form.Item>
          </div>
          {rangeError && (
            <Typography.Text type="danger" role="alert">
              {rangeError}
            </Typography.Text>
          )}
        </>
      )}
      {(field.type === "SINGLE" || field.type === "MULTI") && (
        <ChoiceOptions
          key={`${field.id}:${field.type}`}
          options={field.options ?? []}
          editable={editable}
          onChange={(options) => update({ options })}
        />
      )}
    </Form>
  );
}

/**
 * 明细列与流程引用一样使用稳定标识：排序、改标题均不生成新 ID。
 * 新列取未占用的 column_N，保留旧列属性；只允许 Java 已支持的七类简单控件。
 */
function DetailColumns({ field, editable, onChange }: FieldSettingsProps) {
  const rowsId = `workflow-detail-rows-${useId()}`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<FieldType>("TEXT");
  const columns = field.columns ?? [];
  const duplicateColumnIds = new Set(
    columns
      .filter((column, index) =>
        columns.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index && candidate.id === column.id,
        ),
      )
      .map((column) => column.id),
  );
  // 无法用重复标识安全定位旧列，禁止列属性及编排写入；不自动重编号或批量覆盖同名列。
  const canEditColumns = editable && duplicateColumnIds.size === 0;
  const selected =
    columns.find((column) => column.id === selectedId) ?? columns[0];
  useEffect(() => {
    setSelectedId(null);
    setAddingType("TEXT");
  }, [field.id]);

  function update(columns: WorkflowField[]) {
    if (canEditColumns) onChange({ ...field, columns });
  }

  function move(index: number, target: number) {
    if (!canEditColumns || target < 0 || target >= columns.length) return;
    const reordered = [...columns];
    reordered.splice(target, 0, reordered.splice(index, 1)[0]);
    update(reordered);
  }

  const rowsError =
    field.maxRows != null &&
    (!Number.isInteger(field.maxRows) ||
      field.maxRows < 1 ||
      field.maxRows > 50)
      ? "最多明细行应为 1 至 50 的整数"
      : undefined;

  return (
    <section className="workflow-detail-columns" aria-label="明细列设置">
      <Form component="div" layout="vertical" disabled={!editable}>
        <Form.Item
          label="最多明细行"
          htmlFor={rowsId}
          validateStatus={rowsError ? "error" : undefined}
          help={rowsError}
        >
          <InputNumber
            id={rowsId}
            style={{ width: "100%" }}
            placeholder="默认 20 行"
            value={field.maxRows}
            onChange={(maxRows) => {
              if (editable)
                onChange({ ...field, maxRows: maxRows ?? undefined });
            }}
          />
        </Form.Item>
      </Form>
      <Typography.Text strong>明细列</Typography.Text>
      {duplicateColumnIds.size > 0 && (
        <div>
          <Typography.Text type="danger" role="alert">
            明细列标识重复，不能安全编辑列，请先修复旧配置
          </Typography.Text>
        </div>
      )}
      {columns.map((column, index) => (
        <div
          className="workflow-detail-column-row"
          key={
            duplicateColumnIds.has(column.id)
              ? `${column.id}:${index}`
              : column.id
          }
          style={{ display: "flex", gap: 4, marginTop: 8 }}
        >
          <Button
            type={selected?.id === column.id ? "primary" : "default"}
            aria-label={`选择明细列 ${index + 1}`}
            aria-pressed={selected?.id === column.id}
            style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
            onClick={() => setSelectedId(column.id)}
          >
            {column.label || "未命名列"}
          </Button>
          <Button
            aria-label={`上移明细列 ${index + 1}`}
            disabled={!canEditColumns || index === 0}
            icon={<ArrowUp size={14} />}
            onClick={() => move(index, index - 1)}
          />
          <Button
            aria-label={`下移明细列 ${index + 1}`}
            disabled={!canEditColumns || index === columns.length - 1}
            icon={<ArrowDown size={14} />}
            onClick={() => move(index, index + 1)}
          />
          <Button
            danger
            aria-label={`删除明细列 ${index + 1}`}
            disabled={!canEditColumns || columns.length <= 1}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (!canEditColumns || columns.length <= 1) return;
              update(columns.filter((item) => item.id !== column.id));
            }}
          />
        </div>
      ))}
      {(columns.length === 0 || columns.length > 6) && (
        <Typography.Text type="danger" role="alert">
          明细表需要 1 至 6 列
        </Typography.Text>
      )}
      <Space.Compact block style={{ marginTop: 12 }}>
        <Select<FieldType>
          aria-label="新增明细列类型"
          value={addingType}
          style={{ flex: 1, minWidth: 0 }}
          disabled={!canEditColumns || columns.length >= 6}
          onChange={(type) => {
            if (canEditColumns) setAddingType(type);
          }}
          options={detailColumnTypes.map((value) => ({
            value,
            label: fieldNames[value],
          }))}
        />
        <Button
          icon={<Plus size={14} />}
          disabled={!canEditColumns || columns.length >= 6}
          onClick={() => {
            if (!canEditColumns || columns.length >= 6) return;
            let number = 1;
            while (columns.some((column) => column.id === `column_${number}`))
              number++;
            const column: WorkflowField = {
              id: `column_${number}`,
              label: `明细项${number}`,
              type: addingType,
              required: false,
              ...(addingType === "SINGLE"
                ? { options: ["选项1", "选项2"] }
                : {}),
            };
            update([...columns, column]);
            setSelectedId(column.id);
          }}
        >
          添加列
        </Button>
      </Space.Compact>
      {selected && (
        <section
          className="workflow-column-properties"
          aria-label="当前明细列属性"
          style={{ marginTop: 20 }}
        >
          <Space style={{ marginBottom: 12 }}>
            <Typography.Text strong>
              {selected.label || "未命名列"}
            </Typography.Text>
            <Tag>{fieldNames[selected.type]}</Tag>
          </Space>
          <FieldSettings
            key={selected.id}
            field={selected}
            editable={canEditColumns}
            column
            onChange={(value) =>
              update(
                columns.map((column) =>
                  column.id === selected.id ? value : column,
                ),
              )
            }
          />
        </section>
      )}
    </section>
  );
}

/**
 * OA 三栏设计器的右侧属性面板；选中控件后即时编辑草稿，不使用额外保存弹窗。
 * 字段及明细列的稳定 ID、类型对普通用户保持只读，未知旧属性按原对象保留。
 * editable 同时限制输入与事件处理，防止只读页面通过回调写入草稿。
 */
export function WorkflowFieldProperties({
  field,
  fields = [],
  editable,
  onChange,
}: {
  field: WorkflowField | null;
  fields?: WorkflowField[];
  editable: boolean;
  onChange: (field: WorkflowField) => void;
}) {
  if (!field)
    return (
      <section className="workflow-field-properties" aria-label="字段属性">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择表单中的控件以设置属性"
        />
      </section>
    );
  return (
    <section className="workflow-field-properties" aria-label="字段属性">
      <Space className="workflow-field-properties-heading">
        <Typography.Text strong>控件属性</Typography.Text>
        <Tag>{fieldNames[field.type]}</Tag>
      </Space>
      <FieldSettings
        field={field}
        editable={editable}
        onChange={(value) => {
          if (editable) onChange(value);
        }}
      />
      {field.type === "CALCULATED" && (
        <CalculationSettings
          field={field}
          fields={fields}
          editable={editable}
          onChange={onChange}
        />
      )}
      {field.type === "DETAILS" && (
        <DetailColumns
          key={field.id}
          field={field}
          editable={editable}
          onChange={(value) => {
            if (editable) onChange(value);
          }}
        />
      )}
    </section>
  );
}

/** 用来源字段选择器代替表达式代码；依赖排序由引擎处理，失效引用保留并明确提示。 */
function CalculationSettings({
  field,
  fields,
  editable,
  onChange,
}: FieldSettingsProps & { fields: WorkflowField[] }) {
  const formula = field.formula ?? { operation: "SUM", operands: [], scale: 2 };
  const candidates = fields.filter(
    (source) =>
      source.id !== field.id &&
      (formula.operation === "DETAIL_SUM"
        ? source.type === "DETAILS"
        : formula.operation === "DATE_DAYS"
          ? source.type === "DATE_RANGE"
          : ["NUMBER", "MONEY", "CALCULATED"].includes(source.type)),
  );
  const source = fields.find((item) => item.id === formula.operands[0]);
  function update(patch: Partial<NonNullable<WorkflowField["formula"]>>) {
    if (editable) onChange({ ...field, formula: { ...formula, ...patch } });
  }
  const oneSource =
    formula.operation === "DETAIL_SUM" || formula.operation === "DATE_DAYS";
  return (
    <Form component="div" layout="vertical" disabled={!editable}>
      <Form.Item label="计算方式">
        <Select
          aria-label="计算方式"
          value={formula.operation}
          options={Object.entries(calculationNames).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(operation) =>
            update({
              operation,
              operands: [],
              column: undefined,
              scale: operation === "DATE_DAYS" ? 0 : formula.scale,
            })
          }
        />
      </Form.Item>
      <Form.Item
        label="来源字段"
        extra={
          ["SUBTRACT", "DIVIDE"].includes(formula.operation)
            ? "按选择顺序计算：第一个字段减去或除以第二个字段"
            : undefined
        }
      >
        <Select
          aria-label="计算来源字段"
          mode={oneSource ? undefined : "multiple"}
          value={oneSource ? formula.operands[0] : formula.operands}
          options={candidates.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          maxCount={
            oneSource
              ? undefined
              : ["SUBTRACT", "DIVIDE"].includes(formula.operation)
                ? 2
                : 10
          }
          onChange={(value: string | string[]) =>
            update({
              operands: Array.isArray(value) ? value : [value],
              column: undefined,
            })
          }
        />
      </Form.Item>
      {formula.operation === "DETAIL_SUM" && (
        <Form.Item label="汇总列">
          <Select
            aria-label="汇总列"
            value={formula.column}
            options={source?.columns
              ?.filter((item) => ["NUMBER", "MONEY"].includes(item.type))
              .map((item) => ({ value: item.id, label: item.label }))}
            onChange={(column) => update({ column })}
          />
        </Form.Item>
      )}
      <Form.Item
        label="小数位数"
        extra={
          formula.operation === "DATE_DAYS"
            ? "包含起止两天，按自然日计算"
            : "四舍五入，结果由服务器重新计算"
        }
      >
        <Select
          aria-label="计算小数位数"
          disabled={!editable || formula.operation === "DATE_DAYS"}
          value={formula.scale}
          options={Array.from({ length: 7 }, (_, value) => ({
            value,
            label: `${value} 位`,
          }))}
          onChange={(scale) => update({ scale })}
        />
      </Form.Item>
    </Form>
  );
}
