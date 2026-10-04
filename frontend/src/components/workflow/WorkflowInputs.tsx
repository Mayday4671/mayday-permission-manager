import { Button, ConfigProvider, Input, InputNumber, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { WorkflowField } from "../../types/workflow";

/** 基础输入在主表和明细复用；动态值保持 unknown，提交仍由 Java 校验类型和上下限。 */
export function WorkflowInput({
  field,
  value,
  onChange,
  label,
}: {
  field: WorkflowField;
  value?: unknown;
  onChange?: (value: unknown) => void;
  label?: string;
}) {
  const props = {
    "aria-label": label ?? field.label,
    placeholder: field.placeholder,
  };
  if (field.type === "CALCULATED")
    return (
      <Input
        {...props}
        readOnly
        value={value == null ? "" : String(value)}
        placeholder="自动计算"
      />
    );
  if (field.type === "NUMBER" || field.type === "MONEY")
    return (
      <InputNumber
        {...props}
        value={typeof value === "number" ? value : null}
        min={field.min}
        max={field.max}
        precision={field.type === "MONEY" ? 2 : undefined}
        onChange={onChange}
        style={{ width: "100%" }}
      />
    );
  if (field.type === "SINGLE" || field.type === "MULTI")
    return (
      <Select
        {...props}
        allowClear
        value={value as string | string[] | undefined}
        mode={field.type === "MULTI" ? "multiple" : undefined}
        onChange={onChange}
        options={field.options?.map((option) => ({
          value: option,
          label: option,
        }))}
      />
    );
  if (field.type === "TEXTAREA")
    return (
      <Input.TextArea
        {...props}
        rows={3}
        maxLength={field.maxLength ?? 2000}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange?.(event.target.value)}
        showCount
      />
    );
  return (
    <Input
      {...props}
      value={typeof value === "string" ? value : ""}
      type={
        field.type === "DATE"
          ? "date"
          : field.type === "DATETIME"
            ? "datetime-local"
            : "text"
      }
      maxLength={field.maxLength ?? 2000}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

/** 起止日期使用同一受控值；服务端拒绝不完整、逆序或非法日期。 */
export function WorkflowDateRange({
  value,
  onChange,
  id,
}: {
  value?: string[] | null;
  onChange?: (value: string[] | null) => void;
  id?: string;
}) {
  const update = (index: number, date: string) => {
    const next = [...(value ?? ["", ""])];
    next[index] = date;
    onChange?.(next.every((item) => !item) ? null : next);
  };
  return (
    <div className="workflow-date-range">
      <Input
        id={id}
        aria-label="开始日期"
        type="date"
        value={value?.[0] ?? ""}
        onChange={(event) => update(0, event.target.value)}
      />
      <span>至</span>
      <Input
        aria-label="结束日期"
        type="date"
        min={value?.[0]}
        value={value?.[1] ?? ""}
        onChange={(event) => update(1, event.target.value)}
      />
    </div>
  );
}

/** 明细按行编辑，在窄屏自然换列；添加删除受表单提交锁及发布模型行数限制控制。 */
export function WorkflowDetailRows({
  field,
  value = [],
  onChange,
  id,
}: {
  field: WorkflowField;
  value?: Record<string, unknown>[] | null;
  onChange?: (value: Record<string, unknown>[]) => void;
  id?: string;
}) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const rows = value ?? [];
  const update = (index: number, key: string, cell: unknown) =>
    onChange?.(
      rows.map((row, position) =>
        position === index ? { ...row, [key]: cell } : row,
      ),
    );
  return (
    <div id={id} className="workflow-detail-rows">
      {rows.map((row, index) => (
        <div className="workflow-detail-row" key={index}>
          <div className="workflow-detail-row-head">
            <b>第 {index + 1} 行</b>
            <Button
              type="text"
              danger
              disabled={componentDisabled}
              aria-label={`删除第${index + 1}行`}
              icon={<Trash2 size={14} />}
              onClick={() =>
                onChange?.(rows.filter((_, position) => position !== index))
              }
            />
          </div>
          <div className="workflow-detail-cells">
            {field.columns?.map((column) => (
              <label key={column.id}>
                <span>
                  {column.label}
                  {column.required && <i className="required-mark"> *</i>}
                </span>
                <WorkflowInput
                  field={column}
                  value={row[column.id]}
                  onChange={(cell) => update(index, column.id, cell)}
                  label={`第${index + 1}行${column.label}`}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button
        icon={<Plus size={14} />}
        disabled={componentDisabled || rows.length >= (field.maxRows ?? 20)}
        onClick={() => onChange?.([...rows, {}])}
      >
        添加明细 ({rows.length}/{field.maxRows ?? 20})
      </Button>
    </div>
  );
}
