import { useEffect, useState } from "react";
import { tokenStore } from "../../lib/api";
import type { TelegramCollectedMedia } from "./telegram-media-types";

interface ThumbnailState {
  source?: string;
  error?: string;
}

/** Fetch bounded source covers, never full videos; release private blobs on gallery changes. */
export function useTelegramMediaThumbnails(
  attachments: TelegramCollectedMedia[],
) {
  const ids = attachments
    .filter((item) =>
      ["PHOTO", "VIDEO", "ANIMATION", "DOCUMENT"].includes(item.kind),
    )
    .map((item) => item.id)
    .join(",");
  const [result, setResult] = useState<{
    ids: string;
    entries: Record<number, ThumbnailState>;
  }>({ ids: "", entries: {} });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    const queue = ids ? ids.split(",").map(Number) : [];
    const token = tokenStore.get();
    setResult({ ids, entries: {} });
    const update = (id: number, value: ThumbnailState) => {
      if (!controller.signal.aborted)
        setResult((current) => ({
          ids,
          entries: { ...current.entries, [id]: value },
        }));
    };
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        try {
          const response = await fetch(`/api/telegram/media/${id}/thumbnail`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(35000),
            ]),
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(
              response.status === 403 ? "没有封面读取权限" : "封面暂不可用",
            );
          const blob = await response.blob();
          if (
            !["image/jpeg", "image/png", "image/webp"].includes(blob.type) ||
            !blob.size ||
            blob.size > 2 * 1024 * 1024
          )
            throw new Error("封面格式无效");
          if (controller.signal.aborted) return;
          const source = URL.createObjectURL(blob);
          urls.push(source);
          update(id, { source });
        } catch (cause) {
          update(id, {
            error:
              cause instanceof Error && cause.name === "TimeoutError"
                ? "封面加载超时"
                : "封面暂不可用",
          });
        }
      }
    };
    // Opening an album must not start an unbounded burst of native transfers.
    const workerCount = Math.min(3, queue.length);
    for (let index = 0; index < workerCount; index++) void worker();
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [ids, attempt]);
  return {
    thumbnails: result.ids === ids ? result.entries : {},
    retry: () => setAttempt((value) => value + 1),
  };
}
