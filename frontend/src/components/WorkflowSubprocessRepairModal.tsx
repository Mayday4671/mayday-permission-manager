import { Alert, App, Form, Input, Select, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ApprovalDetail } from "../types/workflow";
import { api, jsonBody } from "../lib/api";
import { FormModal } from "./FormModal";
import { UserSelect } from "./LookupSelect";
import { QueryState } from "./shared";

interface RepairCall {
  tokenId: string;
  callerNodeId: string;
  callerName: string;
  versionId: number;
  nodes: {
    id: string;
    name: string;
    type: "APPROVAL" | "COPY";
    source: string;
    sourceIds: number[];
    people: { value: number; label: string }[];
  }[];
}
interface RepairForm {
  tokenId: string;
  childNodeId: string;
  targetUserIds: number[];
  reason: string;
}
/**
 * 待启动调用尚无子申请时，管理员可逐节点修复失效人员。弹窗版本固定为打开时的父申请版本，
 * 查询只读取固定子版本目录；保存失败保留输入，保存成功后由管理员独立执行恢复。
 */
export function WorkflowSubprocessRepairModal({
  record,
  onClose,
  onSuccess,
}: {
  record: ApprovalDetail | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [form] = Form.useForm<RepairForm>();
  const { message } = App.useApp();
  const query = useQuery({
    queryKey: ["approvals", "subprocess-repair", record?.id, record?.version],
    queryFn: ({ signal }) =>
      api<RepairCall[]>(
        `/operations/requests/${record!.id}/subprocess-repair-options`,
        { signal },
      ),
    enabled: record !== null,
  });
  const tokenId = Form.useWatch("tokenId", form);
  const childNodeId = Form.useWatch("childNodeId", form);
  const call = query.data?.find((item) => item.tokenId === tokenId);
  const node = call?.nodes.find((item) => item.id === childNodeId);
  return (
    <FormModal
      title="修复子流程人员"
      open={record !== null}
      form={form}
      zIndex={1100}
      okText="保存人员修复"
      onCancel={onClose}
      onSubmit={async (values) => {
        if (!record || !query.data) throw new Error("请先加载待启动调用目录");
        if (
          !query.data.some(
            (item) =>
              item.tokenId === values.tokenId &&
              item.nodes.some(
                (candidate) => candidate.id === values.childNodeId,
              ),
          )
        )
          throw new Error("请选择有效的固定调用及审批节点");
        await api(`/operations/requests/${record.id}/subprocess-repair`, {
          method: "POST",
          body: jsonBody({ ...values, version: record.version }),
        });
        message.success(
          "人员修复已保存，请恢复执行；多个失效节点可继续逐项修复",
        );
        onClose();
        await onSuccess();
      }}
    >
      <Alert
        className="form-message"
        type="warning"
        title="仅修复本申请尚未启动的固定子流程"
        description="发布版本、表单和执行位置保持固定。新人员必须拥有有效审批权限；已生成子申请请打开该子申请进行人员交接。保存后不会自动推进流程。"
      />
      <QueryState
        loading={query.isLoading && record !== null}
        error={query.error}
        retry={() => void query.refetch()}
      >
        <Form.Item
          name="tokenId"
          label="待启动调用"
          rules={[{ required: true, message: "请选择待启动调用" }]}
        >
          <Select
            options={query.data?.map((item) => ({
              value: item.tokenId,
              label: `${item.callerName} · 固定版本 ${item.versionId}`,
            }))}
            onChange={() =>
              form.setFieldsValue({ childNodeId: undefined, targetUserIds: [] })
            }
          />
        </Form.Item>
        <Form.Item
          name="childNodeId"
          label="子流程人员节点"
          rules={[{ required: true, message: "请选择审批或抄送节点" }]}
        >
          <Select
            disabled={!call}
            options={call?.nodes.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.type === "COPY" ? "抄送" : "审批"}`,
            }))}
            onChange={() => form.setFieldsValue({ targetUserIds: [] })}
          />
        </Form.Item>
        {node && (
          <div className="form-message" aria-label="原子流程人员来源">
            <span>
              原来源：
              {{
                USERS: "指定人员",
                ROLES: "角色成员",
                DEPARTMENT_LEADER: "部门负责人",
              }[node.source] ?? node.source}
            </span>
            <div>
              {node.people.length
                ? node.people.map((person) => (
                    <Tag key={person.value}>{person.label}</Tag>
                  ))
                : "暂无可解析人员"}
            </div>
          </div>
        )}
        <Form.Item
          name="targetUserIds"
          label="新处理人员"
          extra="替换此节点的完整人员名单，选择顺序为顺签顺序。审批人需审批权限，抄送人需查看权限。其他节点不会改变。"
          rules={[
            {
              required: true,
              type: "array",
              min: 1,
              max: 100,
              message: "请选择 1 至 100 位审批人员",
            },
          ]}
        >
          <UserSelect mode="multiple" disabled={!node} />
        </Form.Item>
        <Form.Item
          name="reason"
          label="修复原因"
          rules={[
            { required: true, whitespace: true, message: "请填写修复原因" },
            { max: 300 },
          ]}
        >
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
      </QueryState>
    </FormModal>
  );
}
