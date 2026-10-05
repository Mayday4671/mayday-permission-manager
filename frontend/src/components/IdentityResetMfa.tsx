import { useState } from "react";
import { Alert, App, Button, Form, Input, Tooltip } from "antd";
import { ShieldOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FormModal } from "./FormModal";
import { api, jsonBody, tokenStore } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { MfaStatus, IdentityProof } from "../lib/identity";
import type { User } from "../types";

interface ResetProof extends IdentityProof {
  reason: string;
}

/** 认证器及恢复码全部遗失时的管理恢复，要求管理者本人近期再认证；目标范围/角色等级由后端决定。 */
export function IdentityResetMfa({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<ResetProof>();
  const { message } = App.useApp();
  const { session } = useAuth();
  const navigate = useNavigate();
  const mfa = useQuery({
    queryKey: ["identity-mfa"],
    queryFn: () => api<MfaStatus>("/auth/identity/mfa"),
    enabled: open,
  });
  return (
    <>
      <Tooltip title="恢复多因素认证">
        <Button
          type="text"
          aria-label="恢复多因素认证"
          icon={<ShieldOff size={15} />}
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        />
      </Tooltip>
      <FormModal<ResetProof>
        title={`恢复 ${user.nickname} 的多因素认证`}
        open={open}
        form={form}
        okText="确认恢复"
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          if (!mfa.data)
            throw new Error("尚未确认管理者的认证状态，请稍后重试");
          await api(`/auth/identity/users/${user.id}/mfa/reset`, {
            method: "POST",
            body: jsonBody({
              password: values.password,
              factor: values.factor,
              reason: values.reason,
            }),
          });
          message.success(
            "多因素认证已恢复，目标账号会退出现有会话并需重新开通",
          );
          setOpen(false);
          if (session?.user.id === user.id) {
            // 本人恢复也已被后端撤销旧会话，立即清除前端身份，不等下一次请求收到 401。
            tokenStore.clear();
            window.dispatchEvent(new Event("mayday:unauthorized"));
            navigate("/login");
          }
        }}
      >
        <Alert
          type="warning"
          title="仅用于用户遗失认证器和全部恢复码。恢复会关闭目标账号 MFA 并撤销其现有会话，请先确认申请人的真实身份。"
          style={{ marginBottom: 16 }}
        />
        <Form.Item
          name="password"
          label="你的当前密码"
          rules={[{ required: true }]}
        >
          <Input.Password autoComplete="current-password" maxLength={72} />
        </Form.Item>
        {mfa.data?.enabled && (
          <Form.Item
            name="factor"
            label="你的认证器验证码或恢复码"
            rules={[{ required: true }]}
          >
            <Input autoComplete="one-time-code" maxLength={64} />
          </Form.Item>
        )}
        <Form.Item
          name="reason"
          label="恢复理由"
          rules={[{ required: true }, { whitespace: true }]}
        >
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
      </FormModal>
    </>
  );
}
