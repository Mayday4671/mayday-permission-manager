import { useState } from "react";
import { Alert, Button, Form, Input, Space } from "antd";
import { api, jsonBody } from "../lib/api";
import type { LoginResult } from "../lib/identity";

interface VerifyDraft {
  factor: string;
}

/** 登录第二阶段只提交短期挑战和验证码/恢复码；失败保留当前输入，取消后必须重新证明首因素。 */
export function IdentityMfaVerify({
  challengeId,
  onVerified,
  onCancel,
}: {
  challengeId: string;
  onVerified: (result: LoginResult) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Form<VerifyDraft>
      layout="vertical"
      disabled={busy}
      onFinish={async (values) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const result = await api<LoginResult>("/auth/identity/mfa/verify", {
            method: "POST",
            body: jsonBody({ challengeId, factor: values.factor }),
          });
          await onVerified(result);
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Alert
        type="info"
        title="请输入认证器的 6 位验证码，也可以使用尚未使用的恢复码。"
      />
      {error && <Alert type="error" title={error} style={{ marginTop: 12 }} />}
      <Form.Item
        name="factor"
        label="身份验证码或恢复码"
        rules={[{ required: true, message: "请输入验证码或恢复码" }]}
      >
        <Input maxLength={64} autoComplete="one-time-code" autoFocus />
      </Form.Item>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Button type="primary" htmlType="submit" block loading={busy}>
          验证并登录
        </Button>
        <Button block onClick={onCancel}>
          重新登录
        </Button>
      </Space>
    </Form>
  );
}
