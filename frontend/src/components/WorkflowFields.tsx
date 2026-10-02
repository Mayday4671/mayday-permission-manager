import {
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  type UploadFile,
} from "antd";
import { UserSelect } from "./LookupSelect";
import { DepartmentField } from "./DepartmentSelect";
import { AttachmentUpload, attachmentIds } from "./AttachmentUpload";
import { AttachmentList } from "./AttachmentList";
import type { WorkflowField } from "../types/workflow";
import type { FileRecord } from "../types/operations";

/** 申请、审批补充、设计器预览共用渲染器。可写字段由服务端给出，不用前端模型推断权限。 */
export function WorkflowFields({ fields }: { fields: WorkflowField[] }) {
  return (
    <div className="workflow-fields">
      {fields.map((field) => (
        <Form.Item
          key={field.id}
          name={["values", field.id]}
          label={field.label}
          className={field.width === 12 ? "half-field" : undefined}
          rules={[
            { required: field.required, message: "请填写" + field.label },
            ...(field.type === "TEXT" || field.type === "TEXTAREA"
              ? [{ max: field.maxLength ?? 2000 }]
              : []),
          ]}
        >
          {field.type === "TEXT" ? (
            <Input maxLength={field.maxLength ?? 2000} />
          ) : field.type === "TEXTAREA" ? (
            <Input.TextArea
              rows={3}
              maxLength={field.maxLength ?? 2000}
              showCount
            />
          ) : field.type === "NUMBER" || field.type === "MONEY" ? (
            <InputNumber
              min={field.min}
              max={field.max}
              precision={field.type === "MONEY" ? 2 : undefined}
              style={{ width: "100%" }}
            />
          ) : field.type === "DATE" ? (
            <Input type="date" />
          ) : field.type === "SINGLE" || field.type === "MULTI" ? (
            <Select
              allowClear
              mode={field.type === "MULTI" ? "multiple" : undefined}
              options={field.options?.map((value) => ({ value, label: value }))}
            />
          ) : field.type === "USER" ? (
            <UserSelect />
          ) : field.type === "DEPARTMENT" ? (
            <DepartmentField />
          ) : (
            <AttachmentUpload />
          )}
        </Form.Item>
      ))}
    </div>
  );
}
/** 文件上传组件使用 UploadFile，网络契约只传服务器 ID；统一在提交边界转换。 */
export function encodeWorkflowValues(
  fields: WorkflowField[],
  values: Record<string, unknown>,
) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.id];
    result[field.id] =
      field.type === "FILES"
        ? attachmentIds((value ?? []) as UploadFile<FileRecord>[])
        : (value ?? null);
  }
  return result;
}
/** 把已鉴权的文件编号恢复成上传控件状态；附件读取仍使用申请范围接口，不复用公开 URL。 */
export function hydrateWorkflowValues(
  fields: WorkflowField[],
  values: Record<string, unknown>,
  files: FileRecord[],
) {
  const result = { ...values };
  for (const field of fields)
    if (field.type === "FILES")
      result[field.id] = ((values[field.id] ?? []) as number[]).map((id) => {
        const file = files.find((f) => f.id === id);
        return {
          uid: String(id),
          name: file?.name ?? "附件",
          status: "done",
          response: file,
        };
      });
  return result;
}
/** 只展示后端已经按当前节点可读范围裁剪的字段，历史附件也走独立参与权校验。 */
export function WorkflowValues({
  fields,
  values,
  labels = {},
  files = [],
  requestId,
}: {
  fields: WorkflowField[];
  values: Record<string, unknown>;
  labels?: Record<string, string>;
  files?: FileRecord[];
  requestId: number;
}) {
  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      items={fields.map((field) => ({
        key: field.id,
        label: field.label,
        children:
          field.type === "FILES" ? (
            <AttachmentList
              files={files.filter((f) =>
                ((values[field.id] ?? []) as number[]).includes(f.id),
              )}
              endpoint={(file) =>
                `/operations/requests/${requestId}/files/${file.id}`
              }
            />
          ) : (
            <span className="preserve-lines">
              {labels[field.id] ??
                (Array.isArray(values[field.id])
                  ? (values[field.id] as string[]).join("、")
                  : String(values[field.id] ?? "—"))}
            </span>
          ),
      }))}
    />
  );
}
