import { Alert, App, Form, Input, Select } from "antd";
import { api, jsonBody } from "../lib/api";
import type { ApprovalDetail } from "../types/workflow";
import { FormModal } from "./FormModal";
import { UserSelect } from "./LookupSelect";

interface Handover {
  fromUserId: number;
  targetUserId: number;
  reason: string;
}
/** 一项申请的管理员交接携带打开时的版本；期间其他人办理后明确冲突，不自动覆盖。 */
export function WorkflowHandoverModal({
  record,
  onClose,
  onSuccess,
}: {
  record: ApprovalDetail | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [form] = Form.useForm<Handover>(),
    { message } = App.useApp();
  return (
    <FormModal
      title="人员交接"
      open={record !== null}
      form={form}
      okText="确认交接"
      onCancel={onClose}
      onSubmit={async (values) => {
        if (!record) return;
        await api(`/operations/requests/${record.id}/handover`, {
          method: "POST",
          body: jsonBody({ version: record.version, ...values }),
        });
        message.success("人员已交接");
        onClose();
        await onSuccess();
      }}
    >
      <Alert
        type="warning"
        className="form-message"
        title="交接当前待办和后续节点人员"
        description="保留原审批记录、顺签次序、字段权限和处理期限。已办结果不更改，发布定义也不更改；原人的有效待办会失效。"
      />
      <Form.Item
        name="fromUserId"
        label="原审批人"
        rules={[{ required: true, message: "请选择要交接的原人员" }]}
      >
        <Select
          placeholder="包含已停用人员"
          options={record?.handoverSources ?? []}
        />
      </Form.Item>
      <Form.Item
        name="targetUserId"
        label="新审批人"
        rules={[{ required: true, message: "请选择新审批人" }]}
      >
        <UserSelect />
      </Form.Item>
      <Form.Item
        name="reason"
        label="交接原因"
        rules={[
          { required: true, whitespace: true, message: "请填写交接原因" },
          { max: 300 },
        ]}
      >
        <Input.TextArea rows={3} maxLength={300} showCount />
      </Form.Item>
    </FormModal>
  );
}
