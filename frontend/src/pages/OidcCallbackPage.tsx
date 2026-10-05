import { useEffect, useRef, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { IdentityMfaVerify } from "../components/IdentityMfaVerify";
import { api, jsonBody } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { LoginResult } from "../lib/identity";

/** 固定 OIDC 回调页立即清除地址中的 code/state，再使用内存值完成一次交换；不在 URL 中传递会话。 */
export function OidcCallbackPage() {
  const [error, setError] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const started = useRef(false);
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state"),
      code = params.get("code");
    window.history.replaceState(null, "", window.location.pathname);
    if (params.has("error") || !state || !code) {
      setError("企业授权已取消或回调不完整，请重新开始");
      return;
    }
    void api<{ bound: boolean; login: LoginResult | null }>(
      "/auth/identity/oidc/complete",
      { method: "POST", body: jsonBody({ state, code }) },
    )
      .then(async (result) => {
        if (result.bound) {
          navigate("/admin/profile", { replace: true });
          return;
        }
        if (!result.login) throw new Error("企业身份响应不完整");
        if (result.login.mfaRequired && result.login.challengeId) {
          setMfaChallenge(result.login.challengeId);
          return;
        }
        await completeLogin(result.login);
        navigate("/admin", { replace: true });
      })
      .catch((failure) => setError((failure as Error).message));
  }, [completeLogin, navigate]);
  return (
    <div className="login-page login-page-compact">
      <div className="login-form-side">
        <div className="login-form-wrap">
          <h2>企业身份验证</h2>
          {error ? (
            <>
              <Alert type="error" title={error} />
              <Button
                block
                style={{ marginTop: 16 }}
                onClick={() => navigate("/login", { replace: true })}
              >
                返回登录
              </Button>
            </>
          ) : mfaChallenge ? (
            <IdentityMfaVerify
              challengeId={mfaChallenge}
              onCancel={() => navigate("/login", { replace: true })}
              onVerified={async (result) => {
                await completeLogin(result);
                navigate("/admin", { replace: true });
              }}
            />
          ) : (
            <Spin description="正在验证企业身份" />
          )}
        </div>
      </div>
    </div>
  );
}
