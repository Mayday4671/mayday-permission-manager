import { useEffect } from "react";
import { Form, Input, InputNumber, Select, Switch } from "antd";
import { FormModal } from "../FormModal";
import {
  fieldNames,
  type WorkflowField,
  type FieldType,
} from "../../types/workflow";
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
  const [form] = Form.useForm();
  const type = Form.useWatch("type", form) as FieldType | undefined;
  useEffect(() => {
    if (field) {
      form.resetFields();
      form.setFieldsValue({ ...field, optionsText: field.options?.join("\n") });
    }
  }, [field]);
  return (
    <FormModal
      title={existing ? "编辑表单字段" : "添加表单字段"}
      open={field !== null}
      form={form}
      onCancel={onClose}
      onSubmit={async (values) => {
        onSave({
          id: values.id,
          label: values.label,
          type: values.type,
          required: !!values.required,
          width: values.width,
          min: values.min,
          max: values.max,
          maxLength: values.maxLength,
          options:
            values.optionsText
              ?.split("\n")
              .map((v: string) => v.trim())
              .filter(Boolean) ?? [],
        });
      }}
    >
      {field && (
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
                options={Object.entries(fieldNames).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="width" label="布局" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 24, label: "整行" },
                  { value: 12, label: "半行" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="required" label="必填" valuePropName="checked">
            <Switch />
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
      )}
    </FormModal>
  );
}
