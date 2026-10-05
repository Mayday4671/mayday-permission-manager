import { api, jsonBody } from "./api";

/** 首因素证明不是登录会话；MFA 挑战不得传入 tokenStore，也不能当成 Bearer 使用。 */
export interface LoginResult {
  token?: string | null;
  mfaRequired?: boolean;
  challengeId?: string | null;
}

/** 公共提供方只有固定标识和显示名称，密钥和账号映射始终留在服务端。 */
export interface IdentityProvider {
  id: string;
  name: string;
}

/** 密码/MFA 操作凭据只保留在弹窗内存中，不进入 URL、浏览器持久存储或分析日志。 */
export interface IdentityProof {
  password: string;
  factor?: string;
  providerId?: string;
}

/** 服务端只返回当前账号已证明的绑定，不暴露外部 subject/email 作为登录线索。 */
export interface IdentityBinding {
  id: string;
  providerId: string;
  providerName: string;
  createdAt: string;
  lastLoginAt?: string | null;
}

/** MFA 摘要允许查看启用状态和未使用码数量，已保存的共享密钥不能再次读取。 */
export interface MfaStatus {
  available: boolean;
  enabled: boolean;
  recoveryCodesRemaining: number;
}

/** 待确认密钥只用于本次扫码；只有提交真实验证码确认后才开通 MFA。 */
export interface MfaEnrollment {
  challengeId: string;
  secret: string;
  provisioningUri: string;
}

/** 企业登录授权地址来自已注册服务端，仍只允许 HTTP(S) URL，拒绝脚本和凭据地址。 */
export async function startEnterpriseLogin(providerId: string): Promise<void> {
  const result = await api<{ authorizationUrl: string }>(
    "/auth/identity/oidc/start",
    { method: "POST", body: jsonBody({ providerId }) },
  );
  redirectToProvider(result.authorizationUrl);
}

/** 身份跳转集中检查协议，其他页面不能把任意 javascript/data 地址作为授权入口。 */
export function redirectToProvider(value: string): void {
  const target = new URL(value);
  if (!/^https?:$/.test(target.protocol) || target.username || target.password)
    throw new Error("企业授权地址不正确，请联系管理员检查配置");
  window.location.assign(target.href);
}
