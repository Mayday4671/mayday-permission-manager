import { useEffect, useState } from "react";
import {
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Select,
  Tag,
  Timeline,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { FormModal } from "../../components/FormModal";
import { DetailsModal } from "../../components/DetailsModal";
import { QueryState, formatTime } from "../../components/shared";
import {
  feedbackDetail,
  feedbackAssignees,
  processFeedback,
} from "../../lib/general-platform";
import type {
  FeedbackRecord,
  FeedbackProcessing,
} from "../../lib/general-platform";
import { useAuth } from "../../lib/auth";

const statusLabels: Record<string, string> = {
  OPEN: "待处理",
  PROCESSING: "处理中",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};
const typeLabels: Record<string, string> = {
  QUESTION: "使用问题",
  SUGGESTION: "功能建议",
  CORRECTION: "内容纠错",
};

/** 客户反馈统一用弹窗处理；公开回复和内部备注明确分字段，错误时保留输入。 */
export function FeedbackPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [id, setId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string>();
  const [form] = Form.useForm<FeedbackProcessing>();
  const detail = useQuery({
    queryKey: ["feedback-detail", id],
    queryFn: () => {
      if (id === null) throw new Error("请选择反馈");
      return feedbackDetail(id);
    },
    enabled: id !== null,
  });
  const assignees = useQuery({
    queryKey: ["feedback-assignees"],
    queryFn: feedbackAssignees,
    enabled: processing && can("feedback:assign"),
  });
  useEffect(() => {
    if (processing && detail.data)
      form.setFieldsValue({
        status: detail.data.status,
        assigneeId: detail.data.assigneeId,
        publicReply: "",
        internalNote: "",
      });
  }, [processing, detail.data, form]);
  return (
    <>
      <ResourcePage<FeedbackRecord>
        resource="feedback"
        endpoint="/operations/feedback"
        title="客户反馈"
        singular="反馈"
        readOnly
        fields={() => null}
        queryParams={{ status }}
        extraFilters={
          <Select
            aria-label="反馈状态"
            allowClear
            placeholder="全部处理状态"
            style={{ width: 140 }}
            value={status}
            onChange={setStatus}
            options={Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        }
        hasExtraFilters={!!status}
        onResetFilters={() => setStatus(undefined)}
        columns={[
          { title: "反馈标题", dataIndex: "title", width: 300, ellipsis: true },
          {
            title: "类型",
            dataIndex: "type",
            width: 110,
            render: (value: string) => typeLabels[value],
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (value: string) => (
              <Tag color={value === "RESOLVED" ? "success" : undefined}>
                {statusLabels[value]}
              </Tag>
            ),
          },
          {
            title: "处理人",
            dataIndex: "assigneeName",
            width: 150,
            render: (value: string) => value || "未分配",
          },
          {
            title: "提交时间",
            dataIndex: "createdAt",
            width: 180,
            render: formatTime,
          },
        ]}
        extraActions={(record) => (
          <Button
            type="link"
            onClick={() => {
              setProcessing(false);
              setId(record.id);
            }}
          >
            查看
          </Button>
        )}
      />
      <DetailsModal
        title="客户反馈"
        open={id !== null && !processing}
        onClose={() => setId(null)}
        width={780}
      >
        <QueryState
          loading={detail.isLoading}
          error={detail.error}
          retry={() => void detail.refetch()}
        >
          {detail.data && (
            <>
              <Descriptions
                column={2}
                items={[
                  {
                    key: "title",
                    label: "标题",
                    children: detail.data.title,
                    span: 2,
                  },
                  {
                    key: "status",
                    label: "状态",
                    children: statusLabels[detail.data.status],
                  },
                  {
                    key: "assignee",
                    label: "处理人",
                    children: detail.data.assigneeName || "未分配",
                  },
                  {
                    key: "contact",
                    label: "联系邮箱",
                    children: detail.data.contact || "未填写",
                  },
                  {
                    key: "article",
                    label: "文章编号",
                    children: detail.data.articleId || "—",
                  },
                ]}
              />
              <p style={{ whiteSpace: "pre-wrap" }}>{detail.data.content}</p>
              {can("feedback:process") && (
                <Button type="primary" onClick={() => setProcessing(true)}>
                  处理反馈
                </Button>
              )}
              {!!detail.data.history.length && (
                <Timeline
                  items={detail.data.history.map((history) => ({
                    key: history.id,
                    content: (
                      <div>
                        <b>{statusLabels[history.status]}</b> · {history.actor}{" "}
                        · {formatTime(history.createdAt)}
                        {history.publicReply && (
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            公开回复：{history.publicReply}
                          </p>
                        )}
                        {history.internalNote && (
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            内部备注：{history.internalNote}
                          </p>
                        )}
                      </div>
                    ),
                  }))}
                />
              )}
            </>
          )}
        </QueryState>
      </DetailsModal>
      <FormModal
        title="处理反馈"
        open={processing && id !== null}
        form={form}
        width={680}
        onCancel={() => setProcessing(false)}
        onSubmit={async (values) => {
          if (!detail.data || id === null) throw new Error("反馈尚未加载");
          await processFeedback(id, {
            ...values,
            assigneeId: values.assigneeId ?? undefined,
            version: detail.data.version,
          });
          message.success("处理结果已保存");
          setProcessing(false);
          await Promise.all([
            client.invalidateQueries({ queryKey: ["feedback-detail", id] }),
            client.invalidateQueries({ queryKey: ["feedback"] }),
          ]);
        }}
      >
        <Form.Item name="status" label="处理状态" rules={[{ required: true }]}>
          <Select
            options={Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Form.Item>
        <Form.Item name="assigneeId" label="分配处理人">
          <Select
            disabled={!can("feedback:assign")}
            allowClear
            showSearch={{ optionFilterProp: "label" }}
            options={assignees.data}
            loading={assignees.isLoading}
          />
        </Form.Item>
        <Form.Item
          name="publicReply"
          label="客户可见回复"
          dependencies={["status"]}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value: string) {
                return getFieldValue("status") === "RESOLVED" && !value?.trim()
                  ? Promise.reject(new Error("解决时请填写客户可见回复"))
                  : Promise.resolve();
              },
            }),
          ]}
        >
          <Input.TextArea rows={4} maxLength={2000} showCount />
        </Form.Item>
        <Form.Item name="internalNote" label="内部备注（客户不可见）">
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>
      </FormModal>
    </>
  );
}
