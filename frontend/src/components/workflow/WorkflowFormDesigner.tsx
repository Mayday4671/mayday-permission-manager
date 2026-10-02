import { Button, Form, Space, Tag } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { WorkflowFields } from "../WorkflowFields";
import {
  fieldNames,
  type FieldType,
  type WorkflowField,
} from "../../types/workflow";

/** 控件库、实际表单预览和字段编排共用运行控件；设计输入不提交业务，也不保存客户数据。 */
export function WorkflowFormDesigner({
  fields,
  editable,
  onAdd,
  onEdit,
  onMove,
  onRemove,
}: {
  fields: WorkflowField[];
  editable: boolean;
  onAdd: (type: FieldType) => void;
  onEdit: (field: WorkflowField) => void;
  onMove: (index: number, target: number) => void;
  onRemove: (field: WorkflowField) => void;
}) {
  const [preview] = Form.useForm();
  return (
    <div className="form-designer-workspace">
      {editable && (
        <aside className="form-designer-palette" aria-label="表单控件库">
          {Object.entries(fieldNames).map(([type, label]) => (
            <Button
              key={type}
              icon={<Plus size={13} />}
              disabled={fields.length >= 40}
              onClick={() => onAdd(type as FieldType)}
            >
              {label}
            </Button>
          ))}
        </aside>
      )}
      <Form form={preview} layout="vertical" className="form-designer-canvas">
        {fields.map((field, index) => (
          <section
            key={field.id}
            className={`form-designer-field ${field.width === 12 ? "half-field" : ""}`}
          >
            <div className="field-card-title">
              <b>{field.label}</b>
              {field.required && <span className="required-mark">*</span>}
              <Tag>{fieldNames[field.type]}</Tag>
            </div>
            <div className="field-design-control">
              <WorkflowFields fields={[field]} preview />
            </div>
            {editable && (
              <Space wrap size={0} className="field-card-footer">
                <Button
                  type="text"
                  aria-label={`上移${field.label}`}
                  disabled={index === 0}
                  icon={<ArrowUp size={14} />}
                  onClick={() => onMove(index, index - 1)}
                />
                <Button
                  type="text"
                  aria-label={`下移${field.label}`}
                  disabled={index === fields.length - 1}
                  icon={<ArrowDown size={14} />}
                  onClick={() => onMove(index, index + 1)}
                />
                <Button type="link" onClick={() => onEdit(field)}>
                  属性
                </Button>
                <Button
                  type="text"
                  danger
                  aria-label={`移除${field.label}`}
                  icon={<Trash2 size={14} />}
                  onClick={() => onRemove(field)}
                />
              </Space>
            )}
          </section>
        ))}
      </Form>
    </div>
  );
}
