import {
  Alert,
  App,
  Button,
  Card,
  Divider,
  Space,
  Switch,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Entry } from "../types";
import { LoginSessionSettings } from "./LoginSessionSettings";

const CAPTCHA_KEY = "security.loginCaptchaEnabled";

/** Global login verification is edited through the versioned system-parameter API. */
export function LoginSecuritySettings() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const policy = useQuery({
    queryKey: ["settings", "login-security"],
    queryFn: async () => {
      const result = await api<{ items: Entry[] }>(
        `/system/entries/settings?keyword=${CAPTCHA_KEY}&size=100`,
      );
      const entry = result.items.find((item) => item.code === CAPTCHA_KEY);
      if (!entry)
        throw new Error("登录安全配置尚未初始化，请检查数据库升级状态");
      return entry;
    },
  });
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const entry = policy.data;
      if (!entry) throw new Error("请先读取登录安全配置");
      return api<Entry>(`/system/entries/settings/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: entry.name,
          code: CAPTCHA_KEY,
          value: String(enabled),
          description: entry.description,
          groupName: entry.groupName,
          valueType: "BOOLEAN",
          enabled: true,
          sortOrder: entry.sortOrder ?? 0,
          version: entry.version,
        }),
      });
    },
    onSuccess: (entry) => {
      client.setQueryData(["settings", "login-security"], entry);
      void client.invalidateQueries({ queryKey: ["settings"] });
      void message.success(
        entry.value === "true"
          ? "登录验证码已开启，立即生效"
          : "登录验证码已关闭，立即生效",
      );
    },
    onError: (error: Error) => {
      void message.error(error.message);
      void policy.refetch();
    },
  });
  return (
    <Card
      title="登录安全"
      style={{ marginBottom: 16 }}
      loading={policy.isPending}
    >
      {policy.error ? (
        <Alert
          type="error"
          showIcon
          title={policy.error.message}
          action={
            <Button onClick={() => void policy.refetch()}>重新读取</Button>
          }
        />
      ) : (
        <Space
          align="start"
          size={24}
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <div>
            <Typography.Text strong>登录验证码</Typography.Text>
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 8, marginBottom: 0 }}
            >
              开启后需完成滑块验证，关闭后直接使用账号密码登录。保存立即对所有用户生效，无需重启；登录失败限流和已启用的
              MFA 保持有效。
            </Typography.Paragraph>
          </div>
          <Switch
            aria-label="登录验证码"
            checked={
              !policy.data?.enabled ||
              policy.data?.valueType !== "BOOLEAN" ||
              policy.data?.value !== "false"
            }
            checkedChildren="开启"
            unCheckedChildren="关闭"
            loading={save.isPending}
            disabled={
              !can("settings:update") || !policy.data || policy.isFetching
            }
            onChange={(value) => save.mutate(value)}
          />
        </Space>
      )}
      <Divider style={{ marginBlock: 20 }} />
      <LoginSessionSettings />
    </Card>
  );
}
