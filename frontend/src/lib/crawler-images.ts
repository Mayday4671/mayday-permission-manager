import { tokenStore } from "./api";

/** 所有采集封面/配图都从本系统鉴权接口读取，页面不会向外站发送令牌或直接加载来源图片。 */
export async function readCrawlImage(
  task: number,
  item: number,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/crawler/tasks/${task}/items/${item}/image`,
    {
      headers: { Authorization: `Bearer ${tokenStore.get()}` },
      signal: signal ?? AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    if (response.status === 401) {
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

export async function downloadCrawlImage(task: number, item: number) {
  const result = await readCrawlImage(task, item);
  const match = result.disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match
    ? decodeURIComponent(match[1])
    : `图片-${item}.${result.blob.type.split("/")[1] || "jpg"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
