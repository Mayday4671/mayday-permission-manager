import { useEffect } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  InputNumber,
  Space,
  Switch,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** Persisted media policy uses bytes; the operator form displays MiB and GiB. */
interface MediaPolicy {
  maxFileBytes: number;
  maxStoredBytes: number;
  downloadTimeoutSeconds: number;
}
interface PolicyForm {
  unlimited: boolean;
  fileMiB: number;
  storageGiB: number;
  timeoutMinutes: number;
}
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** Configures large-file downloads in place without interrupting Telegram authorization. */
export function TelegramMediaPolicySettings() {
  const [form] = Form.useForm<PolicyForm>();
  const unlimited = Form.useWatch("unlimited", form);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ["telegram", "media-policy"],
    queryFn: () => api<MediaPolicy>("/telegram/media-policy"),
  });
  useEffect(() => {
    if (policy.data)
      form.setFieldsValue({
        unlimited: policy.data.maxFileBytes === 0,
        fileMiB: policy.data.maxFileBytes / MIB || 4096,
        storageGiB: policy.data.maxStoredBytes / GIB,
        timeoutMinutes: policy.data.downloadTimeoutSeconds / 60,
      });
  }, [policy.data, form]);
  const save = useMutation({
    mutationFn: (values: PolicyForm) =>
      api<MediaPolicy>("/telegram/media-policy", {
        method: "PUT",
        body: JSON.stringify({
          maxFileBytes: values.unlimited ? 0 : Math.round(values.fileMiB * MIB),
          maxStoredBytes: Math.round(values.storageGiB * GIB),
          downloadTimeoutSeconds: Math.round(values.timeoutMinutes * 60),
        }),
      }),
    onSuccess: (value) => {
      queryClient.setQueryData(["telegram", "media-policy"], value);
      void message.success(
        "媒体设置已保存，新下载和重试立即使用，无需重新登录",
      );
    },
    onError: (error: Error) => void message.error(error.message),
  });
  return (
    <Card title="媒体下载设置" loading={policy.isPending}>
      {policy.error ? (
        <Alert
          type="error"
          showIcon
          title={policy.error.message}
          action={<Button onClick={() => void policy.refetch()}>重试</Button>}
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
          disabled={save.isPending || !policy.data}
        >
          <Form.Item
            name="unlimited"
            label="不限制单个文件大小"
            valuePropName="checked"
            extra="保留原始图片和视频画质，包括 4K；仍需有足够的磁盘空间和总存储容量。"
          >
            <Switch />
          </Form.Item>
          <Space size={24} wrap align="start">
            {!unlimited && (
              <Form.Item
                name="fileMiB"
                label="单文件上限（MiB）"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={2097152} style={{ width: 190 }} />
              </Form.Item>
            )}
            <Form.Item
              name="storageGiB"
              label="总存储容量（GiB）"
              rules={[{ required: true }]}
            >
              <InputNumber
                min={0.1}
                max={2048}
                step={10}
                style={{ width: 190 }}
              />
            </Form.Item>
            <Form.Item
              name="timeoutMinutes"
              label="单次下载最长等待（分钟）"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={1440} style={{ width: 190 }} />
            </Form.Item>
          </Space>

          <div>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存媒体设置
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}
