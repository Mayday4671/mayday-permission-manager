import { useEffect, useState } from "react";
import { App, Alert, Form, Input, Select } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormModal } from "./FormModal";
import { WorkflowFields, encodeWorkflowValues } from "./WorkflowFields";
import { QueryState } from "./shared";
import { api, jsonBody } from "../lib/api";
import type { WorkflowOption, ApprovalDetail } from "../types/workflow";
import type { ContentRecord } from "../types/content";
/** 通用申请与文章送审共用提交入口，文章关联由服务端再次核对版本和作者数据范围。 */
export function ApprovalSubmitModal({
  open,
  onClose,
  content,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  content?: ContentRecord | null;
  onSuccess?: (record: ApprovalDetail) => void;
}) {
  const [form] = Form.useForm();
  // 选择时冻结完整发布选项。重新聚焦、通知或其他窗口发布新版，只更新可选目录，不改填写中的版本。
  const [definition, setDefinition] = useState<WorkflowOption | null>(null);
  const client = useQueryClient();
  const { message } = App.useApp();
  const type = content ? "CONTENT" : "GENERAL";
  const options = useQuery({
    queryKey: ["workflow-options", type],
    queryFn: () =>
      api<WorkflowOption[]>(
        `/operations/workflows/options?businessType=${type}`,
      ),
    enabled: open,
  });
  const newerVersion =
    definition &&
    options.data?.find(
      (item) =>
        item.id === definition.id && item.versionId !== definition.versionId,
    );
  useEffect(() => {
    if (open) {
      form.resetFields();
      setDefinition(null);
      form.setFieldValue(
        "title",
        content
          ? content.title + " · 修订 " + content.revisionNumber
          : undefined,
      );
    }
  }, [open, content?.id]);
  const submitApplication = async (
    values: { title: string; values?: Record<string, unknown> },
    draft: boolean,
  ) => {
    if (!definition) throw new Error("请选择已发布流程");
    if (!values.title?.trim()) throw new Error("请填写申请标题");
    const record = await api<ApprovalDetail>(
      draft ? "/operations/requests/drafts" : "/operations/requests",
      {
        method: "POST",
        body: jsonBody({
          definitionId: definition.id,
          versionId: definition.versionId,
          title: values.title,
          values: encodeWorkflowValues(definition.fields, values.values ?? {}),
          businessId: content?.id,
          businessRevisionId: content?.revisionId,
          businessVersion: content?.version,
        }),
      },
    );
    void client.invalidateQueries();
    message.success(draft ? "草稿已保存" : "申请已提交");
    onClose();
    onSuccess?.(record);
  };
  return (
    <FormModal
      title={content ? "提交内容审核" : "发起审批"}
      open={open}
      onCancel={onClose}
      form={form}
      width={760}
      okText="提交申请"
      secondaryAction={{
        label: "保存草稿",
        onSubmit: (values) => submitApplication(values, true),
      }}
      onSubmit={(values) => submitApplication(values, false)}
    >
      {open && (
        <QueryState
          loading={options.isLoading}
          error={options.error}
          retry={() => void options.refetch()}
        >
          {content && (
            <p className="form-message">
              {content.title} · 修订 {content.revisionNumber}
            </p>
          )}
          {!options.isLoading && !options.data?.length && (
            <Alert
              type="info"
              title="当前没有可发起的已发布流程，请联系流程管理员。"
              className="form-message"
            />
          )}
          {newerVersion && (
            <Alert
              type="warning"
              title={`流程已发布版本 ${newerVersion.versionNumber}，当前表单仍使用版本 ${definition!.versionNumber}。请重新选择流程后按新版本填写。`}
              className="form-message"
            />
          )}
          <Form.Item
            name="definitionId"
            label="审批流程"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="请选择流程"
              options={options.data?.map((d) => ({
                value: d.id,
                label: d.name + " · 版本 " + d.versionNumber,
              }))}
              labelRender={(item) =>
                definition?.id === item.value
                  ? `${definition.name} · 版本 ${definition.versionNumber}`
                  : item.label
              }
              onSelect={(value) => {
                const chosen = options.data?.find((item) => item.id === value);
                if (!chosen) return;
                // 显式选择同一流程也可以切到新版本，且清空旧字段，防止跨版本误带数据。
                setDefinition(structuredClone(chosen));
                form.setFieldValue("values", {});
              }}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label="申请标题"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={160} />
          </Form.Item>
          {definition && <WorkflowFields fields={definition.fields} />}
        </QueryState>
      )}
    </FormModal>
  );
}
