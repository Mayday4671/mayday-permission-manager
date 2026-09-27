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
  const [selected, setSelected] = useState<number>();
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
  const definition = options.data?.find((d) => d.id === selected);
  useEffect(() => {
    if (open) {
      form.resetFields();
      setSelected(undefined);
      form.setFieldValue(
        "title",
        content
          ? content.title + " · 修订 " + content.revisionNumber
          : undefined,
      );
    }
  }, [open, content?.id]);
  return (
    <FormModal
      title={content ? "提交内容审核" : "发起审批"}
      open={open}
      onCancel={onClose}
      form={form}
      width={760}
      okText="提交申请"
      onSubmit={async (values) => {
        if (!definition) throw new Error("请选择已发布流程");
        const record = await api<ApprovalDetail>("/operations/requests", {
          method: "POST",
          body: jsonBody({
            definitionId: definition.id,
            versionId: definition.versionId,
            title: values.title,
            values: encodeWorkflowValues(
              definition.fields,
              values.values ?? {},
            ),
            businessId: content?.id,
            businessRevisionId: content?.revisionId,
            businessVersion: content?.version,
          }),
        });
        void client.invalidateQueries();
        message.success("申请已提交");
        onClose();
        onSuccess?.(record);
      }}
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
              onChange={(value) => {
                setSelected(value);
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
