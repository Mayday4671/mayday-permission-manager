import { useEffect } from "react";
import { Button, Form, Input, InputNumber, Select, Switch, Tabs } from "antd";
import { FormModal } from "../FormModal";
import {
  fieldNames,
  type WorkflowField,
  type FieldType,
} from "../../types/workflow";

/** 编辑器将多行选项输入统一转换成模型数组，不把展示用字段写进发布契约。 */
interface ColumnDraft extends WorkflowField {
  optionsText?: string;
}
interface FieldDraft extends Omit<WorkflowField, "columns"> {
  optionsText?: string;
  columns?: ColumnDraft[];
}
/** 字段属性编辑与稳定 ID 分离，改名称不破坏节点引用。 */
export function FieldEditor({
  field,
  existing,
  onClose,
  onSave,
}: {
  field: WorkflowField | null;
  existing: boolean;
  onClose: () => void;
  onSave: (field: WorkflowField) => void;
}) {
  const [form] = Form.useForm<FieldDraft>();
  const type = Form.useWatch("type", form) as FieldType | undefined;
  useEffect(() => {
    if (field) {
      form.resetFields();
      form.setFieldsValue({
        ...field,
        optionsText: field.options?.join("\n"),
        columns: field.columns?.map((column) => ({
          ...column,
          optionsText: column.options?.join("\n"),
        })),
      });
    }
  }, [field]);
  return (
    <FormModal
      title={existing ? "编辑表单字段" : "添加表单字段"}
      open={field !== null}
      form={form}
      onCancel={onClose}
      onSubmit={async () => {
        const values = form.getFieldsValue(true) as FieldDraft;
        onSave({
          id: values.id,
          label: values.label,
          type: values.type,
          required: !!values.required,
          width: values.width,
          min: values.min,
          max: values.max,
          maxLength: values.maxLength,
          placeholder: values.placeholder,
          helpText: values.helpText,
          maxRows: values.type === "DETAILS" ? values.maxRows : undefined,
          columns:
            values.type === "DETAILS"
              ? values.columns?.map((column) => ({
                  id: column.id,
                  label: column.label,
                  type: column.type,
                  required: !!column.required,
                  min: column.min,
                  max: column.max,
                  maxLength: column.maxLength,
                  options: column.optionsText
                    ?.split("\n")
                    .map((option) => option.trim())
                    .filter(Boolean),
                }))
              : undefined,
          options:
            values.optionsText
              ?.split("\n")
              .map((v: string) => v.trim())
              .filter(Boolean) ?? [],
        });
      }}
    >
      {field && (
        <Tabs
          key={field.id}
          defaultActiveKey="basic"
          items={[
            {
              key: "basic",
              label: "基础属性",
              forceRender: true,
              children: (
                <>
                  <div className="form-two-columns">
                    <Form.Item
                      name="label"
                      label="字段名称"
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input maxLength={60} />
                    </Form.Item>
                    <Form.Item
                      name="id"
                      label="字段 ID"
                      rules={[
                        { required: true },
                        {
                          pattern: /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
                          message: "使用字母开头的英文、数字、下划线",
                        },
                      ]}
                    >
                      <Input disabled={existing} maxLength={40} />
                    </Form.Item>
                  </div>
                  <div className="form-two-columns">
                    <Form.Item
                      name="type"
                      label="控件类型"
                      rules={[{ required: true }]}
                    >
                      <Select
                        onChange={(value) => {
                          if (
                            value === "DETAILS" &&
                            !form.getFieldValue("columns")?.length
                          )
                            form.setFieldValue("columns", [
                              {
                                id: "item",
                                label: "项目",
                                type: "TEXT",
                                required: true,
                              },
                              {
                                id: "amount",
                                label: "金额",
                                type: "MONEY",
                                required: true,
                                min: 0,
                              },
                            ]);
                        }}
                        options={Object.entries(fieldNames).map(
                          ([value, label]) => ({
                            value,
                            label,
                          }),
                        )}
                      />
                    </Form.Item>
                    <Form.Item
                      name="width"
                      label="布局"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { value: 24, label: "整行" },
                          { value: 12, label: "半行" },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="required"
                    label="必填"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item name="placeholder" label="输入提示">
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name="helpText" label="填写说明">
                    <Input.TextArea rows={2} maxLength={500} />
                  </Form.Item>
                  {(type === "TEXT" || type === "TEXTAREA") && (
                    <Form.Item name="maxLength" label="最大长度">
                      <InputNumber min={1} max={10000} />
                    </Form.Item>
                  )}
                  {(type === "NUMBER" || type === "MONEY") && (
                    <div className="form-two-columns">
                      <Form.Item name="min" label="最小值">
                        <InputNumber />
                      </Form.Item>
                      <Form.Item name="max" label="最大值">
                        <InputNumber />
                      </Form.Item>
                    </div>
                  )}
                  {(type === "SINGLE" || type === "MULTI") && (
                    <Form.Item
                      name="optionsText"
                      label="选项"
                      extra="每行一个值，最多 50 个，值不能重复。"
                      rules={[{ required: true }]}
                    >
                      <Input.TextArea rows={5} />
                    </Form.Item>
                  )}
                </>
              ),
            },
            ...(type === "DETAILS"
              ? [
                  {
                    key: "columns",
                    label: "明细列",
                    forceRender: true,
                    children: (
                      <>
                        {" "}
                        {type === "DETAILS" && (
                          <>
                            <Form.Item name="maxRows" label="最多明细行">
                              <InputNumber
                                min={1}
                                max={50}
                                placeholder="默认20行"
                              />
                            </Form.Item>
                            <Form.List
                              name="columns"
                              rules={[
                                {
                                  validator: async (_, columns) => {
                                    if (!columns?.length || columns.length > 6)
                                      throw new Error("需要1至6列明细");
                                  },
                                },
                              ]}
                            >
                              {(columns, { add, remove }, { errors }) => (
                                <div>
                                  <Tabs
                                    items={columns.map((column) => ({
                                      key: String(column.key),
                                      label: `第 ${column.name + 1} 列`,
                                      forceRender: true,
                                      children: (
                                        <div
                                          className="workflow-detail-column"
                                          key={column.key}
                                        >
                                          <div className="form-two-columns">
                                            <Form.Item
                                              name={[column.name, "label"]}
                                              label="列名称"
                                              rules={[
                                                {
                                                  required: true,
                                                  whitespace: true,
                                                },
                                              ]}
                                            >
                                              <Input maxLength={60} />
                                            </Form.Item>
                                            <Form.Item
                                              name={[column.name, "id"]}
                                              label="列标识"
                                              rules={[
                                                { required: true },
                                                {
                                                  pattern:
                                                    /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
                                                },
                                              ]}
                                            >
                                              <Input maxLength={40} />
                                            </Form.Item>
                                            <Form.Item
                                              name={[column.name, "type"]}
                                              label="类型"
                                              rules={[{ required: true }]}
                                            >
                                              <Select
                                                options={[
                                                  "TEXT",
                                                  "TEXTAREA",
                                                  "NUMBER",
                                                  "MONEY",
                                                  "DATE",
                                                  "DATETIME",
                                                  "SINGLE",
                                                ].map((value) => ({
                                                  value,
                                                  label:
                                                    fieldNames[
                                                      value as FieldType
                                                    ],
                                                }))}
                                              />
                                            </Form.Item>
                                            <Form.Item
                                              name={[column.name, "required"]}
                                              label="必填"
                                              valuePropName="checked"
                                            >
                                              <Switch />
                                            </Form.Item>
                                          </div>
                                          <Form.Item noStyle shouldUpdate>
                                            {() => {
                                              const columnType =
                                                form.getFieldValue([
                                                  "columns",
                                                  column.name,
                                                  "type",
                                                ]) as FieldType;
                                              return (
                                                <>
                                                  {(columnType === "TEXT" ||
                                                    columnType ===
                                                      "TEXTAREA") && (
                                                    <Form.Item
                                                      name={[
                                                        column.name,
                                                        "maxLength",
                                                      ]}
                                                      label="最大长度"
                                                    >
                                                      <InputNumber
                                                        min={1}
                                                        max={10000}
                                                      />
                                                    </Form.Item>
                                                  )}
                                                  {(columnType === "NUMBER" ||
                                                    columnType === "MONEY") && (
                                                    <div className="form-two-columns">
                                                      <Form.Item
                                                        name={[
                                                          column.name,
                                                          "min",
                                                        ]}
                                                        label="最小值"
                                                      >
                                                        <InputNumber />
                                                      </Form.Item>
                                                      <Form.Item
                                                        name={[
                                                          column.name,
                                                          "max",
                                                        ]}
                                                        label="最大值"
                                                      >
                                                        <InputNumber />
                                                      </Form.Item>
                                                    </div>
                                                  )}
                                                  {columnType === "SINGLE" && (
                                                    <Form.Item
                                                      name={[
                                                        column.name,
                                                        "optionsText",
                                                      ]}
                                                      label="单选项"
                                                      rules={[
                                                        { required: true },
                                                      ]}
                                                    >
                                                      <Input.TextArea
                                                        rows={2}
                                                        placeholder="每行一个选项"
                                                      />
                                                    </Form.Item>
                                                  )}
                                                </>
                                              );
                                            }}
                                          </Form.Item>
                                          <Button
                                            danger
                                            onClick={() => remove(column.name)}
                                          >
                                            删除此列
                                          </Button>
                                        </div>
                                      ),
                                    }))}
                                  />
                                  <Form.ErrorList errors={errors} />
                                  <Button
                                    disabled={columns.length >= 6}
                                    onClick={() =>
                                      add({
                                        id: `column${columns.length + 1}`,
                                        label: "新列",
                                        type: "TEXT",
                                        required: false,
                                      })
                                    }
                                  >
                                    添加明细列
                                  </Button>
                                </div>
                              )}
                            </Form.List>
                          </>
                        )}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </FormModal>
  );
}
