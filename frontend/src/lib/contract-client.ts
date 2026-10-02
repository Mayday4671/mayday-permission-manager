import createClient from "openapi-fetch";
import type { paths } from "../types/generated/api";
import { ApiError, tokenStore } from "./api";

/** 类型来自真实控制器契约；路径、动作、查询参数与请求字段由编译器检查。 */
export const contractClient = createClient<paths>({
  baseUrl: window.location.origin,
  fetch: (request) =>
    fetch(request, { signal: request.signal ?? AbortSignal.timeout(20000) }),
});

contractClient.use({
  onRequest({ request }) {
    const token = tokenStore.get();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    // openapi-fetch 创建的 Request 自带信号；显式合并超时，外部取消仍然有效。
    return new Request(request, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
  },
  onResponse({ request, response }) {
    if (
      response.status === 401 &&
      !new URL(request.url).pathname.endsWith("/auth/login")
    ) {
      tokenStore.clear();
      window.dispatchEvent(new Event("mayday:unauthorized"));
    }
  },
});

/** 只在公共边界解包；业务组件不处理令牌、错误信封或底层请求细节。 */
export function unwrapContract<
  T extends { success?: boolean; data?: unknown; message?: string },
>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Exclude<T["data"], undefined> {
  if (
    !result.response.ok ||
    !result.data?.success ||
    !("data" in result.data)
  ) {
    const error = result.error;
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : (result.data?.message ?? "服务响应异常，请稍后重试");
    throw new ApiError(message, result.response.status);
  }
  return result.data.data as Exclude<T["data"], undefined>;
}
