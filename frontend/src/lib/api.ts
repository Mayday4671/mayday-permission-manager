/**
 * 统一网络边界：只接受后端标准响应，统一超时、错误与登录失效事件。
 * 令牌仅放在当前标签页 sessionStorage，不放 URL，不记录日志。生产部署使用 HTTPS。
 */
const TOKEN_KEY = "mayday.session";
export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};
/** 保留服务器 HTTP 状态，界面可以区分会话失效、授权拒绝和业务校验失败。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}
/** 同源请求与生成契约共享错误展示；只信任随机UUID定位号，代理413也能显示明确上传提示。 */
export function responseError(
  response: Response,
  explanation?: string,
): ApiError {
  const header = response.headers.get("X-Request-ID");
  const requestId =
    header && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(header)
      ? header
      : undefined;
  const message =
    explanation ||
    (response.status === 413
      ? "上传内容超过服务器限制，请减小文件后重试"
      : "服务响应异常，请稍后重试");
  return new ApiError(
    response.status >= 500 && requestId
      ? `${message}（故障编号：${requestId}）`
      : message,
    response.status,
    requestId,
  );
}
/** 同源标准信封请求；合并取消和超时信号，仅同一令牌的 401 可以触发退出。 */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = tokenStore.get();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const result: unknown = await response.json().catch(() => null);
  const envelope =
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    typeof result.success === "boolean"
      ? result
      : null;
  if (!response.ok || envelope?.success !== true || !("data" in envelope)) {
    // 旧账号的慢请求不能在新账号登录后清除新令牌；只撤销发出本次请求的同一会话。
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      token === tokenStore.get()
    ) {
      tokenStore.clear();
      window.dispatchEvent(new Event("mayday:unauthorized"));
    }
    const explanation =
      envelope &&
      "message" in envelope &&
      typeof envelope.message === "string" &&
      envelope.message
        ? envelope.message
        : undefined;
    throw responseError(response, explanation);
  }
  return envelope.data as T;
}
/** 自动跳过空筛选项，保证 false/0 等合法值不会被误删。 */
export function queryString(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  });
  return query.toString();
}
export const jsonBody = (value: unknown) => JSON.stringify(value);
