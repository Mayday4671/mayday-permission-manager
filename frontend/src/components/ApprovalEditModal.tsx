import { useEffect } from "react";
import { App, Form, Input } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { FormModal } from "./FormModal";
import {
  WorkflowFields,
  encodeWorkflowValues,
  hydrateWorkflowValues,
} from "./WorkflowFields";
import { api, jsonBody } from "../lib/api";
import type { ApprovalDetail } from "../types/workflow";

interface ApplicationValues {
  title: string;
  values: Record<string, unknown>;
}
/** 草稿、退回、撤回后的原申请共用编辑入口；沿用实例冻结字段，不能替换流程或业务修订。 */
export function ApprovalEditModal({
  record,
  onClose,
}: {
  record: ApprovalDetail | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ApplicationValues>();
  const client = useQueryClient(),
    { message } = App.useApp();
  useEffect(() => {
    if (record) {
      form.resetFields();
      form.setFieldsValue({
        title: record.title,
        values: hydrateWorkflowValues(
          record.fields,
          record.values,
          record.files,
        ),
      });
    }
  }, [record?.id]);
  const save = async (values: ApplicationValues, submit: boolean) => {
    if (!record) return;
    if (!values.title?.trim()) throw new Error("请填写申请标题");
    await api(`/operations/requests/${record.id}${submit ? "/submit" : ""}`, {
      method: submit ? "POST" : "PUT",
      body: jsonBody({
        version: record.version,
        title: values.title,
        values: encodeWorkflowValues(record.fields, values.values ?? {}),
        businessVersion: record.business?.noticeVersion,
      }),
    });
    await client.invalidateQueries();
    message.success(
      submit ? "申请已提交，旧待办不会参与本轮审批" : "修改已保存",
    );
    onClose();
  };
  return (
    <FormModal
      title={record?.status === "DRAFT" ? "继续填写申请" : "修改申请"}
      open={record !== null}
      form={form}
      onCancel={onClose}
      width={860}
      zIndex={1100}
      okText="提交申请"
      onSubmit={(values) => save(values, true)}
      secondaryAction={{
        label: "保存修改",
        onSubmit: (values) => save(values, false),
      }}
    >
      {record && (
        <>
          <p className="form-message">
            {record.definitionName} · 发布版本 {record.definitionVersionNumber}
            。重新提交会从起点办理。
          </p>
          <Form.Item
            name="title"
            label="申请标题"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={160} />
          </Form.Item>
          <WorkflowFields fields={record.fields} />
        </>
      )}
    </FormModal>
  );
}
