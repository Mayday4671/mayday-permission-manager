import { useEffect } from "react";
import { Alert, App, Button, Form, InputNumber, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Entry } from "../types";

const SESSION_POLICY_KEY = "security.sessionPolicy";

interface SessionLimits {
  absoluteMinutes: number;
  idleMinutes: number;
  maxPerUser: number;
}

/** 会话期限作为一个带版本的系统参数原子保存，避免三个字段部分成功或互相覆盖。 */
export function LoginSessionSettings() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<SessionLimits>();
  const policy = useQuery({
    queryKey: ["settings", "login-sessions"],
    queryFn: async () => {
      const result = await api<{ items: Entry[] }>(
        `/system/entries/settings?keyword=${SESSION_POLICY_KEY}&size=10`,
      );
      const entry = result.items.find(
        (item) => item.code === SESSION_POLICY_KEY,
      );
      if (!entry)
        throw new Error("登录会话参数尚未初始化，请检查数据库升级状态");
      const limits: SessionLimits = JSON.parse(entry.value ?? "{}");
      if (
        !Number.isInteger(limits.absoluteMinutes) ||
        !Number.isInteger(limits.idleMinutes) ||
        !Number.isInteger(limits.maxPerUser)
      )
        throw new Error("登录会话参数格式异常，请检查参数值");
      return { entry, limits };
    },
  });
  useEffect(() => {
    if (policy.data) form.setFieldsValue(policy.data.limits);
  }, [form, policy.data]);
  const save = useMutation({
    mutationFn: async (limits: SessionLimits) => {
      const entry = policy.data?.entry;
      if (!entry) throw new Error("请先读取登录会话参数");
      return api<Entry>(`/system/entries/settings/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: entry.name,
          code: SESSION_POLICY_KEY,
          value: JSON.stringify(limits),
          description: entry.description,
          groupName: entry.groupName,
          valueType: "JSON",
          enabled: true,
          sortOrder: entry.sortOrder ?? 0,
          version: entry.version,
        }),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["settings"] });
      void message.success("登录会话设置已保存，无需重启");
    },
    onError: (error: Error) => {
      void message.error(error.message);
      void policy.refetch();
    },
  });
  if (policy.error)
    return (
      <Alert
        type="error"
        showIcon
        title={policy.error.message}
        action={<Button onClick={() => void policy.refetch()}>重新读取</Button>}
      />
    );
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={(values) => save.mutate(values)}
      disabled={
        !can("settings:update") ||
        !policy.data ||
        save.isPending ||
        policy.isFetching
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0 24px",
        }}
      >
        <Form.Item
          name="absoluteMinutes"
          label="登录有效期（分钟）"
          rules={[
            {
              required: true,
              type: "integer",
              min: 5,
              max: 10080,
              message: "请输入 5–10080 的整数",
            },
          ]}
        >
          <InputNumber
            min={5}
            max={10080}
            precision={0}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item
          name="idleMinutes"
          label="空闲超时（分钟）"
          dependencies={["absoluteMinutes"]}
          rules={[
            {
              required: true,
              type: "integer",
              min: 1,
              message: "请输入大于零的整数",
            },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return value == null ||
                  value <= getFieldValue("absoluteMinutes")
                  ? Promise.resolve()
                  : Promise.reject(new Error("空闲超时不能超过登录有效期"));
              },
            }),
          ]}
        >
          <InputNumber
            min={1}
            max={10080}
            precision={0}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item
          name="maxPerUser"
          label="同时登录上限（个）"
          rules={[
            {
              required: true,
              type: "integer",
              min: 1,
              max: 20,
              message: "请输入 1–20 的整数",
            },
          ]}
        >
          <InputNumber
            min={1}
            max={20}
            precision={0}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        空闲按无认证请求计算，页面自动刷新也算活动。缩短时限对已有登录生效；调长不延长已签发会话的固定到期时间。登录数量超限时，下次登录将退出最早的会话。
      </Typography.Paragraph>
      <Button type="primary" htmlType="submit" loading={save.isPending}>
        保存会话设置
      </Button>
    </Form>
  );
}
