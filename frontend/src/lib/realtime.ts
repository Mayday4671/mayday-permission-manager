import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "./api";
import { useAuth } from "./auth";
import { consumeSse } from "./realtime-model";

/** 中止重连等待时同时清理计时器，登出或切换账号不会遗留旧账号后台请求。 */
function reconnectDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/**
 * 顶栏只建立一个当前账号的实时流。fetch 允许 Authorization 头，无需把主令牌写入 URL。
 * 推送只使缓存失效，列表、详情和计数仍由受权限保护的 API 获取；15 秒轮询一直保留作兜底。
 */
export function useRealtimeUpdates() {
  const { session, can } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const enabled = can("messages:view") || can("requests:view");
  useEffect(() => {
    if (!userId || !enabled) return;
    const lifecycle = new AbortController();
    let currentStream: AbortController | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") currentStream?.abort();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const refresh = (topics: string[]) => {
      if (topics.includes("messages")) {
        void queryClient.invalidateQueries({ queryKey: ["messages"] });
        void queryClient.invalidateQueries({ queryKey: ["unread"] });
      }
      if (topics.includes("requests")) {
        void queryClient.invalidateQueries({ queryKey: ["requests"] });
        void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      }
    };
    const run = async () => {
      let attempts = 0;
      while (!lifecycle.signal.aborted && tokenStore.get()) {
        if (document.visibilityState === "hidden") {
          await reconnectDelay(1000, lifecycle.signal);
          continue;
        }
        currentStream = new AbortController();
        const streamController = currentStream;
        let heartbeatTimeout = window.setTimeout(
          () => streamController.abort(),
          35000,
        );
        try {
          const response = await fetch("/api/operations/realtime/stream", {
            headers: { Authorization: `Bearer ${tokenStore.get()}` },
            cache: "no-store",
            signal: AbortSignal.any([lifecycle.signal, currentStream.signal]),
          });
          if (response.status === 401) {
            tokenStore.clear();
            window.dispatchEvent(new Event("mayday:unauthorized"));
            break;
          }
          // 权限或模块关闭后停止本连接；身份上下文更新后会按新权限重新决定是否订阅。
          if (response.status === 403 || response.status === 404) break;
          if (
            !response.ok ||
            !response.body ||
            !response.headers.get("Content-Type")?.includes("text/event-stream")
          )
            throw new Error("实时服务暂不可用");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            while (!lifecycle.signal.aborted) {
              const { value, done } = await reader.read();
              if (done) break;
              // 无心跳的半开连接必须重建，不能一直等待服务器已经失去的连接。
              window.clearTimeout(heartbeatTimeout);
              heartbeatTimeout = window.setTimeout(
                () => streamController.abort(),
                35000,
              );
              buffer += decoder.decode(value, { stream: true });
              const parsed = consumeSse(buffer);
              buffer = parsed.remainder;
              for (const event of parsed.events) {
                if (event.event === "ready") {
                  attempts = 0;
                  // 不重放业务正文；重连先拉取当前状态，覆盖离线期间错过的变化。
                  refresh(["messages", "requests"]);
                } else if (event.event === "changed") {
                  try {
                    const data: unknown = JSON.parse(event.data);
                    if (
                      data &&
                      typeof data === "object" &&
                      "topics" in data &&
                      Array.isArray(data.topics)
                    )
                      refresh(
                        data.topics.filter(
                          (topic): topic is string => typeof topic === "string",
                        ),
                      );
                  } catch {
                    // 单条畸形事件不影响后续心跳和正常刷新。
                  }
                }
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        } catch {
          // 连接失败无需弹窗；轮询继续工作，连接按退避重建。
        } finally {
          window.clearTimeout(heartbeatTimeout);
        }
        if (lifecycle.signal.aborted) break;
        attempts += 1;
        await reconnectDelay(
          Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)),
          lifecycle.signal,
        );
      }
    };
    void run();
    return () => {
      lifecycle.abort();
      currentStream?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, queryClient, userId]);
}
