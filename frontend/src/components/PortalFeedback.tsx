import { useState } from "react";
import { App, Button, Form, Input, Select, Timeline, Typography } from "antd";
import { useParams } from "react-router-dom";
import { FormModal } from "./FormModal";
import { DetailsModal } from "./DetailsModal";
import { submitFeedback, trackFeedback } from "../lib/general-platform";
import type {
  FeedbackSubmission,
  TrackedFeedback,
} from "../lib/general-platform";
import { formatTime } from "./shared";
import { useModules } from "../lib/modules";

const statuses: Record<string, string> = {
  OPEN: "待处理",
  PROCESSING: "处理中",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

/** 门户支持入口没有后台链接；随机查询码只显示给提交者，内部备注从接口投影中排除。 */
export function PortalFeedback() {
  const modules = useModules();
  const { id: articleId } = useParams();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [result, setResult] = useState<TrackedFeedback | null>(null);
  const [form] = Form.useForm<FeedbackSubmission>();
  const [trackForm] = Form.useForm<{ receipt: string }>();
  if (!modules.feedback) return null;
  return (
    <>
      <span className="site-feedback-actions">
        <Button
          type="link"
          onClick={() => {
            form.resetFields();
            form.setFieldValue("type", articleId ? "CORRECTION" : "QUESTION");
            setSubmitting(true);
          }}
        >
          反馈问题
        </Button>
        <Button
          type="link"
          onClick={() => {
            trackForm.resetFields();
            setTracking(true);
          }}
        >
          查询反馈
        </Button>
      </span>
      <FormModal
        title="提交反馈"
        open={submitting}
        form={form}
        okText="提交"
        onCancel={() => setSubmitting(false)}
        onSubmit={async (values) => {
          const created = await submitFeedback({
            ...values,
            articleId:
              articleId && /^\d+$/.test(articleId)
                ? Number(articleId)
                : undefined,
          });
          setSubmitting(false);
          setReceipt(created.receipt);
          message.success("反馈已提交");
        }}
      >
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "QUESTION", label: "使用问题" },
              { value: "SUGGESTION", label: "功能建议" },
              { value: "CORRECTION", label: "内容纠错" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input maxLength={160} />
        </Form.Item>
        <Form.Item
          name="content"
          label="详细说明"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea rows={5} maxLength={4000} showCount />
        </Form.Item>
        <Form.Item
          name="contact"
          label="联系邮箱（选填）"
          rules={[{ type: "email" }]}
        >
          <Input maxLength={254} />
        </Form.Item>
      </FormModal>
      <DetailsModal
        title="反馈已提交"
        open={receipt !== null}
        onClose={() => setReceipt(null)}
      >
        <p>请保存查询码，用于查询进度和回复。</p>
        <Typography.Paragraph
          copyable={{ text: receipt ?? "" }}
          style={{ overflowWrap: "anywhere" }}
        >
          {receipt}
        </Typography.Paragraph>
      </DetailsModal>
      <FormModal
        title="查询反馈"
        open={tracking}
        form={trackForm}
        okText="查询"
        confirmDiscard={false}
        onCancel={() => setTracking(false)}
        onSubmit={async (values) => {
          const tracked = await trackFeedback(values.receipt.trim());
          setResult(tracked);
          setTracking(false);
        }}
      >
        <Form.Item
          name="receipt"
          label="查询码"
          rules={[
            { required: true },
            { pattern: /^[a-f0-9]{48}$/, message: "请输入完整查询码" },
          ]}
        >
          <Input autoComplete="off" maxLength={48} />
        </Form.Item>
      </FormModal>
      <DetailsModal
        title="反馈处理进度"
        open={result !== null}
        onClose={() => setResult(null)}
      >
        {result && (
          <>
            <b>{result.title}</b>
            <p>
              {statuses[result.status]} · {formatTime(result.createdAt)}
            </p>
            {result.history.length ? (
              <Timeline
                items={result.history.map((history, index) => ({
                  key: index,
                  content: (
                    <>
                      <b>{statuses[history.status]}</b> ·{" "}
                      {formatTime(history.createdAt)}
                      {history.reply && (
                        <p style={{ whiteSpace: "pre-wrap" }}>
                          {history.reply}
                        </p>
                      )}
                    </>
                  ),
                }))}
              />
            ) : (
              <p>反馈已收到，等待处理。</p>
            )}
          </>
        )}
      </DetailsModal>
    </>
  );
}
