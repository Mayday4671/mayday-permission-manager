import { Button, Input, InputNumber, Select, Space } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type {
  WorkflowConditionRule,
  WorkflowField,
} from "../../types/workflow";

/** 嵌套组以业务关系显示，稳定字段引用不使用下标；操作不自动改写旧分支或添加人工连线。 */
export function ConditionGroupEditor({
  value,
  onChange,
  fields,
}: {
  value?: WorkflowConditionRule;
  onChange?: (value: WorkflowConditionRule) => void;
  fields: WorkflowField[];
}) {
  const root = value ?? {
    logic: "AND",
    children: [{ field: "", operator: "EQ", value: "" }],
  };
  const choices = fields.filter((field) =>
    [
      "TEXT",
      "TEXTAREA",
      "NUMBER",
      "MONEY",
      "CALCULATED",
      "DATE",
      "DATETIME",
      "SINGLE",
    ].includes(field.type),
  );
  function count(rule: WorkflowConditionRule): number {
    return rule.logic
      ? (rule.children ?? []).reduce((total, child) => total + count(child), 0)
      : 1;
  }
  const total = count(root);
  function render(
    rule: WorkflowConditionRule,
    change: (next: WorkflowConditionRule) => void,
    path: string,
    depth: number,
  ) {
    if (rule.logic)
      return (
        <section
          className="workflow-condition-group"
          aria-label={`条件组${path}`}
        >
          <Select
            aria-label={`条件组${path}关系`}
            value={rule.logic}
            style={{ width: "100%" }}
            options={[
              { value: "AND", label: "以下条件全部满足" },
              { value: "OR", label: "以下条件任一满足" },
            ]}
            onChange={(logic) => change({ ...rule, logic })}
          />
          {(rule.children ?? []).map((child, index) => (
            <div key={index} className="workflow-condition-row">
              {render(
                child,
                (next) =>
                  change({
                    ...rule,
                    children: rule.children!.map((item, position) =>
                      position === index ? next : item,
                    ),
                  }),
                `${path}.${index + 1}`,
                depth + 1,
              )}
              <Button
                size="small"
                type="text"
                danger
                aria-label={`删除判断${path}.${index + 1}`}
                icon={<Trash2 size={14} />}
                disabled={rule.children!.length <= 1}
                onClick={() =>
                  change({
                    ...rule,
                    children: rule.children!.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Space wrap>
            <Button
              size="small"
              icon={<Plus size={14} />}
              disabled={total >= 20 || depth >= 3}
              onClick={() =>
                change({
                  ...rule,
                  children: [
                    ...(rule.children ?? []),
                    { field: "", operator: "EQ", value: "" },
                  ],
                })
              }
            >
              添加判断
            </Button>
            <Button
              size="small"
              disabled={total >= 20 || depth >= 2}
              onClick={() =>
                change({
                  ...rule,
                  children: [
                    ...(rule.children ?? []),
                    {
                      logic: "AND",
                      children: [{ field: "", operator: "EQ", value: "" }],
                    },
                  ],
                })
              }
            >
              添加分组
            </Button>
          </Space>
        </section>
      );
    const field = choices.find((candidate) => candidate.id === rule.field);
    const numeric =
      field && ["NUMBER", "MONEY", "CALCULATED"].includes(field.type);
    return (
      <div className="workflow-condition-leaf">
        <Select
          aria-label={`判断${path}字段`}
          value={rule.field || undefined}
          placeholder="选择字段"
          options={choices.map((field) => ({
            value: field.id,
            label: field.label,
          }))}
          onChange={(field) => change({ field, operator: "EQ", value: "" })}
        />
        <Select
          aria-label={`判断${path}方式`}
          value={rule.operator}
          options={[
            { value: "EQ", label: "等于" },
            { value: "NE", label: "不等于" },
            ...(numeric
              ? [
                  { value: "GT", label: "大于" },
                  { value: "GE", label: "大于等于" },
                  { value: "LT", label: "小于" },
                  { value: "LE", label: "小于等于" },
                ]
              : []),
            { value: "CONTAINS", label: "包含" },
          ]}
          onChange={(operator) => change({ ...rule, operator })}
        />
        {/* 分组与旧单条件保持相同语义：包含编辑文字子串，等于/不等于选原始选项。 */}
        {field?.type === "SINGLE" &&
        ["EQ", "NE"].includes(rule.operator ?? "") ? (
          <Select
            aria-label={`判断${path}值`}
            value={rule.value || undefined}
            placeholder="选择比较值"
            options={field.options?.map((value) => ({ value, label: value }))}
            onChange={(value) => change({ ...rule, value })}
          />
        ) : numeric && rule.operator !== "CONTAINS" ? (
          <InputNumber<string>
            stringMode
            aria-label={`判断${path}值`}
            value={rule.value || null}
            onChange={(value) =>
              change({ ...rule, value: value == null ? "" : String(value) })
            }
          />
        ) : (
          <Input
            aria-label={`判断${path}值`}
            value={rule.value}
            maxLength={1000}
            placeholder="比较值"
            type={
              field?.type === "DATE"
                ? "date"
                : field?.type === "DATETIME"
                  ? "datetime-local"
                  : "text"
            }
            onChange={(event) => change({ ...rule, value: event.target.value })}
          />
        )}
      </div>
    );
  }
  return render(root, (next) => onChange?.(next), "1", 0);
}
