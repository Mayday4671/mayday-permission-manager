import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Brand } from "../components/shared";
import { SlideCaptcha } from "../components/SlideCaptcha";
import { IdentityMfaVerify } from "../components/IdentityMfaVerify";
import { api } from "../lib/api";
import { startEnterpriseLogin, type IdentityProvider } from "../lib/identity";
import { useAuth } from "../lib/auth";
import { useModules } from "../lib/modules";
import { adminRouteTarget } from "../lib/workspace-model";

/** 登录凭证仅保存在当前表单和一次验证回调的内存中，不写入 URL 或浏览器持久存储。 */
interface LoginCredentials {
  username: string;
  password: string;
}

/** 登录使用真实认证接口。错误就地展示，初始凭证只写入项目说明，不在公共页面泄露。 */
export function LoginPage() {
  const modules = useModules();
  const { login, completeLogin, session, can } = useAuth();
  const providers = useQuery({
    queryKey: ["identity-providers"],
    queryFn: () => api<IdentityProvider[]>("/auth/identity/providers"),
    retry: false,
  });
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // 导航状态不是可信数据；只接受后台路径，具体页面权限仍由路由守卫重新验证。
  const navigationState: unknown = location.state;
  const requestedPath =
    navigationState &&
    typeof navigationState === "object" &&
    "from" in navigationState
      ? adminRouteTarget(navigationState.from)
      : undefined;
  const destination = requestedPath
    ? requestedPath
    : can("dashboard:view")
      ? "/admin"
      : "/admin/profile";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<LoginCredentials | null>(null);
  const submitting = useRef(false);
  const [form] = Form.useForm<LoginCredentials>();
  /** 凭证只在内存中传递给一次登录；验证失败、取消或密码错误均须重新验证。 */
  const verifiedLogin = async (captchaToken: string) => {
    if (!credentials || submitting.current) return;
    const values = credentials;
    submitting.current = true;
    setCredentials(null);
    setLoading(true);
    setError("");
    try {
      const result = await login(
        values.username,
        values.password,
        captchaToken,
      );
      form.resetFields(["password"]);
      if (result?.mfaRequired && result.challengeId)
        setMfaChallenge(result.challengeId);
      else navigate(requestedPath ?? "/admin");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };
  if (session) return <Navigate to={destination} replace />;
  return (
    <div className="login-page login-page-compact">
      <div className="login-form-side">
        {modules.portal && (
          <Link to="/" className="back-to-portal">
            前台门户
          </Link>
        )}
        <div className="login-form-wrap">
          <Link to={modules.portal ? "/" : "/login"}>
            <Brand />
          </Link>
          <h2>后台登录</h2>
          <p>{mfaChallenge ? "验证登录身份" : "请输入账号和密码"}</p>
          {error && (
            <Alert
              title={error}
              type="error"
              showIcon
              className="login-error"
            />
          )}
          {mfaChallenge ? (
            <IdentityMfaVerify
              challengeId={mfaChallenge}
              onCancel={() => {
                setMfaChallenge(null);
                setError("");
              }}
              onVerified={async (result) => {
                await completeLogin(result);
                navigate(requestedPath ?? "/admin");
              }}
            />
          ) : (
            <Form<LoginCredentials>
              form={form}
              layout="vertical"
              onFinish={async (values) => {
                if (loading || credentials) return;
                setError("");
                setCredentials(values);
              }}
              requiredMark={false}
            >
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: "请输入用户名" }]}
              >
                <Input
                  size="large"
                  autoComplete="username"
                  placeholder="输入你的用户名"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input.Password
                  size="large"
                  autoComplete="current-password"
                  placeholder="输入你的登录密码"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
              >
                登录
              </Button>
            </Form>
          )}
          {!mfaChallenge &&
            providers.data?.map((provider) => (
              <Button
                key={provider.id}
                block
                style={{ marginTop: 12 }}
                disabled={loading}
                onClick={async () => {
                  if (loading) return;
                  setLoading(true);
                  setError("");
                  try {
                    await startEnterpriseLogin(provider.id);
                  } catch (failure) {
                    setError((failure as Error).message);
                    setLoading(false);
                  }
                }}
              >
                {provider.name}登录
              </Button>
            ))}
          <p className="login-support">还没有账号？请联系你的团队管理员。</p>
          <SlideCaptcha
            open={credentials !== null}
            username={credentials?.username ?? ""}
            onCancel={() => setCredentials(null)}
            onVerified={(token) => {
              void verifiedLogin(token);
            }}
          />
        </div>
      </div>
    </div>
  );
}
