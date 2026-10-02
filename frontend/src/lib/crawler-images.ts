import { tokenStore } from "./api";

/** 所有采集封面/配图都从本系统鉴权接口读取，页面不会向外站发送令牌或直接加载来源图片。 */
export async function readCrawlImage(
  taskId: number,
  itemId: number,
  signal?: AbortSignal,
) {
  const requestedToken = tokenStore.get();
  const response = await fetch(
    `/api/crawler/tasks/${taskId}/items/${itemId}/image`,
    {
      headers: { Authorization: `Bearer ${requestedToken ?? ""}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    if (response.status === 401 && requestedToken === tokenStore.get()) {
      tokenStore.clear();
      window.dispatchEvent(new Event("mayday:unauthorized"));
    }
    throw new Error("无法读取图片，请检查权限或重新登录");
  }
  return {
    blob: await response.blob(),
    disposition: response.headers.get("Content-Disposition") ?? "",
  };
}

/** 下载名只来自受控响应；损坏的编码退回安全名称，创建的对象 URL 总会定时释放。 */
export async function downloadCrawlImage(taskId: number, itemId: number) {
  const result = await readCrawlImage(taskId, itemId);
  const match = result.disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href = url;
  const fallback = `图片-${itemId}.${result.blob.type.split("/")[1] || "jpg"}`;
  try {
    link.download = match ? decodeURIComponent(match[1]) : fallback;
  } catch {
    link.download = fallback;
  }
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
