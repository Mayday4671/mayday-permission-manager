import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Flex,
  QRCode,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FormModal } from "./FormModal";
import { useIdentityRecoveryCodes } from "./IdentityRecoveryCodesProvider";
import { QueryState, SectionTitle } from "./shared";
import { api, jsonBody, tokenStore } from "../lib/api";
import {
  redirectToProvider,
  type IdentityBinding,
  type IdentityProof,
  type IdentityProvider,
  type MfaEnrollment,
  type MfaStatus,
} from "../lib/identity";

interface EnrollmentCode {
  factor: string;
}
type Action = "enroll" | "disable" | "recovery" | "bind" | IdentityBinding;

/** 个人中心管理 MFA 与企业身份；密码和扫码密钥仅留在本次表单，恢复码交给路由上层一次性展示。 */
export function IdentitySecurityPanel() {
  const [action, setAction] = useState<Action | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const { present } = useIdentityRecoveryCodes();
  const [proofForm] = Form.useForm<IdentityProof>();
  const [codeForm] = Form.useForm<EnrollmentCode>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const status = useQuery({
    queryKey: ["identity-mfa"],
    queryFn: () => api<MfaStatus>("/auth/identity/mfa"),
  });
  const bindings = useQuery({
    queryKey: ["identity-bindings"],
    queryFn: () => api<IdentityBinding[]>("/auth/identity/bindings"),
  });
  const providers = useQuery({
    queryKey: ["identity-providers"],
    queryFn: () => api<IdentityProvider[]>("/auth/identity/providers"),
  });
  /** 入口和弹窗共用可绑定集合；未知或失败的查询不能把已绑定方式当作新增选项。 */
  const availableProviders = useMemo(
    () =>
      providers.isSuccess && bindings.isSuccess
        ? providers.data.filter(
            (provider) =>
              !bindings.data.some(
                (binding) => binding.providerId === provider.id,
              ),
          )
        : [],
    [providers.data, providers.isSuccess, bindings.data, bindings.isSuccess],
  );
  /** 配置刷新或其他会话完成绑定后，移除失效选择；无剩余方式时关闭并清除本次身份证明。 */
  useEffect(() => {
    if (action !== "bind") return;
    if (!availableProviders.length) {
      proofForm.resetFields();
      setAction(null);
      return;
    }
    const selected = proofForm.getFieldValue("providerId");
    if (
      selected &&
      !availableProviders.some((provider) => provider.id === selected)
    )
      proofForm.setFields([
        { name: "providerId", value: undefined, errors: [] },
      ]);
  }, [action, availableProviders, proofForm]);
  /** 无恢复码返回的安全变更也须同步结束已被后端撤销的旧会话，禁止继续操作。 */
  const signOut = () => {
    tokenStore.clear();
    window.dispatchEvent(new Event("mayday:unauthorized"));
    navigate("/login");
  };
  const open = (value: Action) => {
    if (value === "bind" && !availableProviders.length) return;
    proofForm.resetFields();
    setAction(value);
  };
  const title =
    action === "enroll"
      ? "开通多因素认证"
      : action === "disable"
        ? "关闭多因素认证"
        : action === "recovery"
          ? "重新生成恢复码"
          : action === "bind"
            ? "绑定企业身份"
            : "解除企业身份绑定";
  return (
    <section className="panel">
      <SectionTitle title="登录保护" />
      <QueryState
        loading={status.isLoading}
        error={status.error}
        retry={() => void status.refetch()}
      >
        {status.data && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <strong>多因素认证</strong>
              <Tag color={status.data.enabled ? "success" : "default"}>
                {status.data.enabled ? "已开通" : "未开通"}
              </Tag>
            </Space>
            <p>
              登录时在账号密码或企业身份验证后，继续验证认证器动态码。恢复码仅能使用一次，请独立保管。
            </p>
            {status.data.enabled ? (
              <Space wrap>
                <Button onClick={() => open("recovery")}>
                  重新生成恢复码（剩余 {status.data.recoveryCodesRemaining} 个）
                </Button>
                <Button danger onClick={() => open("disable")}>
                  关闭认证
                </Button>
              </Space>
            ) : status.data.available ? (
              <Button onClick={() => open("enroll")}>开通认证器验证</Button>
            ) : (
              <Alert type="info" title="管理员尚未配置多因素认证开通。" />
            )}
          </>
        )}
      </QueryState>
      <div style={{ marginTop: 24 }}>
        <Space wrap>
          <strong>企业身份</strong>
          {availableProviders.length > 0 && (
            <Button onClick={() => open("bind")}>绑定登录方式</Button>
          )}
        </Space>
      </div>
      <QueryState
        loading={bindings.isLoading}
        error={bindings.error}
        retry={() => void bindings.refetch()}
      >
        {bindings.data?.length ? (
          <ul style={{ padding: 0, listStyle: "none" }}>
            {bindings.data.map((binding) => (
              <li key={binding.id}>
                <Flex
                  align="center"
                  justify="space-between"
                  gap={12}
                  wrap
                  style={{ padding: "12px 0" }}
                >
                  <div>
                    <strong>{binding.providerName}</strong>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0 }}
                    >
                      绑定于 {new Date(binding.createdAt).toLocaleDateString()}
                    </Typography.Paragraph>
                  </div>
                  <Button danger type="link" onClick={() => open(binding)}>
                    解除绑定
                  </Button>
                </Flex>
              </li>
            ))}
          </ul>
        ) : (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            尚未绑定企业登录方式
          </Typography.Paragraph>
        )}
      </QueryState>
      <FormModal<IdentityProof>
        open={action !== null}
        form={proofForm}
        title={title}
        okText="确认"
        onCancel={() => setAction(null)}
        onSubmit={async (values) => {
          if (!action) return;
          const proof = { password: values.password, factor: values.factor };
          if (action === "enroll") {
            const result = await api<MfaEnrollment>(
              "/auth/identity/mfa/enroll",
              { method: "POST", body: jsonBody(proof) },
            );
            codeForm.resetFields();
            setEnrollment(result);
            setAction(null);
            return;
          }
          if (action === "bind") {
            if (
              !availableProviders.some(
                (provider) => provider.id === values.providerId,
              )
            )
              throw new Error("企业登录方式已更新，请重新选择");
            const result = await api<{ authorizationUrl: string }>(
              "/auth/identity/oidc/bind",
              {
                method: "POST",
                body: jsonBody({ ...proof, providerId: values.providerId }),
              },
            );
            setAction(null);
            redirectToProvider(result.authorizationUrl);
            return;
          }
          if (action === "recovery") {
            const result = await api<string[]>("/auth/identity/mfa/recovery", {
              method: "POST",
              body: jsonBody(proof),
            });
            present(result);
            return;
          }
          const path =
            action === "disable"
              ? "/auth/identity/mfa/disable"
              : `/auth/identity/bindings/${action.id}/remove`;
          await api(path, { method: "POST", body: jsonBody(proof) });
          setAction(null);
          message.success("登录保护已更新，请重新登录");
          signOut();
        }}
      >
        <Alert
          type="warning"
          title="请再次验证本人身份。安全设置变更后会撤销现有登录会话。"
          style={{ marginBottom: 16 }}
        />
        {action === "bind" && (
          <Form.Item
            name="providerId"
            label="企业登录方式"
            rules={[
              { required: true, message: "请选择企业登录方式" },
              {
                validator: (_rule, value) =>
                  !value ||
                  availableProviders.some((provider) => provider.id === value)
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error("企业登录方式已更新，请重新选择"),
                      ),
              },
            ]}
          >
            <Select
              virtual={false}
              options={availableProviders.map((provider) => ({
                value: provider.id,
                label: provider.name,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item
          name="password"
          label="当前本地密码"
          rules={[{ required: true, message: "请输入当前密码" }]}
        >
          <Input.Password autoComplete="current-password" maxLength={72} />
        </Form.Item>
        {status.data?.enabled && (
          <Form.Item
            name="factor"
            label="认证器验证码或恢复码"
            rules={[{ required: true, message: "请输入身份验证码或恢复码" }]}
          >
            <Input autoComplete="one-time-code" maxLength={64} />
          </Form.Item>
        )}
      </FormModal>
      <FormModal<EnrollmentCode>
        title="扫描并确认开通"
        open={enrollment !== null}
        form={codeForm}
        onCancel={() => setEnrollment(null)}
        okText="确认开通"
        onSubmit={async (values) => {
          if (!enrollment) return;
          const result = await api<string[]>("/auth/identity/mfa/confirm", {
            method: "POST",
            body: jsonBody({
              challengeId: enrollment.challengeId,
              factor: values.factor,
            }),
          });
          present(result);
        }}
      >
        {enrollment && (
          <>
            <p>
              使用支持 TOTP 的认证器扫描二维码，然后输入当前 6
              位验证码。二维码和密钥只在本次显示。
            </p>
            <QRCode type="svg" value={enrollment.provisioningUri} />
            <Typography.Paragraph
              copyable={{ text: enrollment.secret }}
              style={{ marginTop: 12 }}
            >
              手动密钥：{enrollment.secret}
            </Typography.Paragraph>
            <Form.Item
              name="factor"
              label="6 位动态验证码"
              rules={[
                { required: true },
                { pattern: /^\d{6}$/, message: "请输入 6 位验证码" },
              ]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </Form.Item>
          </>
        )}
      </FormModal>
    </section>
  );
}
