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
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
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
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({
    success: false,
    message: "服务响应异常，请检查后端是否已启动",
  }));
  if (!response.ok || !result.success) {
    if (response.status === 401 && path !== "/auth/login") {
      tokenStore.clear();
      window.dispatchEvent(new Event("mayday:unauthorized"));
    }
    throw new ApiError(result.message || "操作失败，请重试", response.status);
  }
  return result.data as T;
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
