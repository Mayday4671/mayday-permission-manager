import { useEffect, useRef, useState } from "react";
import { Alert, Button, Image, Modal, Space, Spin, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "../../lib/api";
import { AuthenticatedHlsVideo } from "./AuthenticatedHlsVideo";
import { telegramVideoPreviewMode } from "./telegram-video-policy";
import {
  TelegramAttachmentDownload,
  telegramDownloadName,
} from "./TelegramAttachmentDownload";
import type {
  TelegramCollectionTask,
  TelegramCollectedMessage,
  TelegramCollectedMedia,
  TelegramVideoPreviewStatus,
} from "./telegram-media-types";

const ACTIVE_TASKS = ["QUEUED", "RUNNING"];
const ACTIVE_MEDIA = ["QUEUED", "DOWNLOADING"];

/** A Telegram photo contains several resolutions of the same image, not an album. */
export function previewAttachments(rows: TelegramCollectedMessage[]) {
  return rows.flatMap((row) => {
    const photos = row.media.filter((item) => item.kind === "PHOTO");
    // Prefer a ready resolution so a failed full-size download cannot hide a usable image.
    const ready = photos.filter((item) => item.status === "AVAILABLE");
    const largest = (ready.length ? ready : photos).reduce<
      TelegramCollectedMedia | undefined
    >(
      (best, item) =>
        !best ||
        (item.actualSize ?? item.expectedSize ?? 0) >
          (best.actualSize ?? best.expectedSize ?? 0)
          ? item
          : best,
      undefined,
    );
    return [
      ...row.media.filter((item) => item.kind !== "PHOTO"),
      ...(largest ? [largest] : []),
    ];
  });
}

/** Follows both task and file progress; an empty page is never evidence of absent media. */
export function TelegramMessageMediaPreview({
  taskId,
  messageLink,
  onClose,
  onRetry,
  retrying,
}: {
  taskId: number;
  messageLink: string;
  onClose: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const result = useQuery({
    queryKey: ["telegram", "inline-media-preview", taskId],
    queryFn: async ({ signal }) => {
      const task = await api<TelegramCollectionTask>(
        `/telegram/collections/${taskId}`,
        { signal },
      );
      // Read progress first so a task finishing between the two requests cannot
      // produce a completed status paired with an older, empty message page.
      const page = await api<{ items: TelegramCollectedMessage[] }>(
        `/telegram/collections/${taskId}/messages?page=1&size=50`,
        { signal },
      );
      return { task, rows: page.items };
    },
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const value = query.state.data;
      return !value ||
        ACTIVE_TASKS.includes(value.task.status) ||
        value.rows.some((row) =>
          row.media.some((item) => ACTIVE_MEDIA.includes(item.status)),
        )
        ? 1200
        : false;
    },
    retry: false,
  });
  const retryAttachments = useMutation({
    mutationFn: async () => {
      const failedItems = previewAttachments(result.data?.rows ?? []).filter(
        (item) => ["FAILED", "EXPIRED"].includes(item.status),
      );
      const outcomes = await Promise.allSettled(
        failedItems.map((item) =>
          api(`/telegram/media/${item.id}/retry`, { method: "POST" }),
        ),
      );
      const rejected = outcomes.find(
        (outcome) => outcome.status === "rejected",
      );
      if (rejected?.status === "rejected") throw rejected.reason;
    },
    onSettled: () => void result.refetch(),
  });
  const task = result.data?.task;
  // A failed recheck must remove cached players, especially after permission revocation.
  const rows = result.error ? [] : (result.data?.rows ?? []);
  const attachments = previewAttachments(rows);
  const ready = attachments.filter((item) => item.status === "AVAILABLE");
  const pending = attachments.filter((item) =>
    ACTIVE_MEDIA.includes(item.status),
  );
  const failed = attachments.filter(
    (item) => !["AVAILABLE", ...ACTIVE_MEDIA].includes(item.status),
  );
  const reading = result.isPending || ACTIVE_TASKS.includes(task?.status ?? "");
  const stopped = task && !["COMPLETED", ...ACTIVE_TASKS].includes(task.status);
  const protectedMessage = rows.some((row) => !row.canBeSaved);
  const genuinelyEmpty =
    task?.status === "COMPLETED" && !attachments.length && !protectedMessage;

  return (
    <Modal
      title="附件预览"
      open
      onCancel={onClose}
      width={960}
      footer={<Button onClick={onClose}>关闭</Button>}
      destroyOnHidden
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        {result.error ? (
          <Alert
            type="error"
            showIcon
            title="预览状态读取失败"
            description={result.error.message}
            action={
              <Button
                onClick={() => void result.refetch()}
                loading={result.isFetching}
              >
                重新读取
              </Button>
            }
          />
        ) : null}
        {reading && !result.error ? (
          <div role="status" style={{ padding: "32px 0", textAlign: "center" }}>
            <Spin />
            <p>
              {task?.status === "QUEUED"
                ? "正在排队读取原消息…"
                : "正在读取原消息…"}
            </p>
          </div>
        ) : null}
        {stopped && !result.error ? (
          <Alert
            type={task.status === "FAILED" ? "error" : "warning"}
            showIcon
            title={
              task.status === "WAITING_ACCOUNT"
                ? "等待 Telegram 账号连接"
                : "原消息读取未完成"
            }
            description={task.statusMessage}
            action={
              task.status === "FAILED" || task.status === "CANCELLED" ? (
                <Button onClick={onRetry} loading={retrying}>
                  重新读取
                </Button>
              ) : (
                <Button
                  onClick={() => void result.refetch()}
                  loading={result.isFetching}
                >
                  刷新状态
                </Button>
              )
            }
          />
        ) : null}
        {pending.length ? (
          <div role="status">
            <Spin size="small" /> 正在下载 {pending.length}{" "}
            个媒体文件，完成后自动显示…
          </div>
        ) : null}
        {failed.length ? (
          <Alert
            type="warning"
            showIcon
            title="部分媒体未能加载"
            description={failed
              .map((item) => item.failureMessage || "媒体已失效，请重新读取")
              .join("；")}
            action={
              <Button
                onClick={() => retryAttachments.mutate()}
                loading={retryAttachments.isPending}
              >
                重试下载
              </Button>
            }
          />
        ) : null}
        {retryAttachments.error && (
          <Alert type="error" showIcon title={retryAttachments.error.message} />
        )}
        {protectedMessage ? (
          <Alert
            type="warning"
            showIcon
            title="原消息限制保存媒体"
            description="当前账号不能下载这条消息的附件，请在 Telegram 中查看。"
          />
        ) : null}
        {genuinelyEmpty && !result.error ? (
          <Alert
            type="info"
            showIcon
            title={
              rows.length ? "这条原消息没有可下载的附件" : "未读取到原消息"
            }
            description={
              rows.length
                ? "搜索结果的类型标签不代表链接一定包含媒体，请查看原消息。"
                : "请重新读取，或检查来源消息是否仍可访问。"
            }
          />
        ) : null}
        {ready.length ? (
          <Image.PreviewGroup>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  ready.length === 1
                    ? "minmax(0, 1fr)"
                    : "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 16,
                maxHeight: "65vh",
                overflowY: "auto",
                minWidth: 0,
              }}
            >
              {ready.map((attachment) => (
                <Space
                  key={attachment.id}
                  orientation="vertical"
                  size={12}
                  style={{ width: "100%", minWidth: 0 }}
                >
                  <TelegramInlineMediaItem attachment={attachment} />
                  <TelegramAttachmentDownload attachment={attachment} />
                </Space>
              ))}
            </div>
          </Image.PreviewGroup>
        ) : null}
        <Typography.Link
          href={messageLink}
          target="_blank"
          rel="noopener noreferrer"
        >
          在 Telegram 查看原消息
        </Typography.Link>
      </Space>
    </Modal>
  );
}

/** Fetches private images with authorization and releases buffers when the modal closes. */
function TelegramInlineImage({
  attachment,
}: {
  attachment: TelegramCollectedMedia;
}) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setSource(undefined);
    setError(undefined);
    const token = tokenStore.get();
    void (async () => {
      if (!attachment.contentUrl) throw new Error("当前账号没有图片读取权限");
      const response = await fetch(attachment.contentUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20000),
        ]),
      });
      if (response.status === 403) throw new Error("当前账号没有图片读取权限");
      if (response.status === 404)
        throw new Error("图片已被清理或删除，请重新读取原消息");
      if (!response.ok) throw new Error("图片读取失败，请检查登录状态后重试");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    })().catch((cause: Error) => {
      if (!controller.signal.aborted)
        setError(
          cause.name === "TimeoutError"
            ? "图片加载超时，请重试"
            : cause.message,
        );
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.contentUrl, attempt]);
  if (error)
    return (
      <Alert
        type="error"
        title={error}
        action={
          <Button onClick={() => setAttempt((value) => value + 1)}>
            重试图片
          </Button>
        }
      />
    );
  return source ? (
    <Image
      src={source}
      alt={attachment.fileName ?? "Telegram 图片"}
      onError={() => setError("图片无法解码，请重试或查看原消息")}
      styles={{
        root: { width: "100%" },
        image: { width: "100%", maxHeight: "60vh", objectFit: "contain" },
      }}
    />
  ) : (
    <div role="status">
      <Spin /> 正在加载图片…
    </div>
  );
}

/** Plays native video or offers authenticated conversion for other supported containers. */
export function TelegramInlineMediaItem({
  attachment,
}: {
  attachment: TelegramCollectedMedia;
}) {
  const [playbackError, setPlaybackError] = useState(false);
  const [convert, setConvert] = useState(false);
  const playbackPosition = useRef(0);
  const restorePosition = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const playbackMode = telegramVideoPreviewMode(attachment);
  const nativeVideo = playbackMode === "native";
  const previewKey = ["telegram", "video-preview", attachment.id];
  const ticket = useQuery({
    queryKey: ["telegram", "inline-stream-ticket", attachment.id],
    queryFn: () =>
      api<{ url: string }>(`/telegram/media/${attachment.id}/stream-ticket`, {
        method: "POST",
      }),
    enabled: nativeVideo && !convert,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: () =>
      api<TelegramVideoPreviewStatus>(
        `/telegram/media/${attachment.id}/video-preview`,
      ),
    enabled: convert,
    refetchInterval: (query) =>
      ["QUEUED", "PROCESSING"].includes(query.state.data?.status ?? "")
        ? 1500
        : false,
    retry: false,
  });
  const convertVideo = useMutation({
    mutationFn: () =>
      api<TelegramVideoPreviewStatus>(
        `/telegram/media/${attachment.id}/video-preview`,
        { method: "POST" },
      ),
    onSuccess: (value) => {
      queryClient.setQueryData(previewKey, value);
      setConvert(true);
    },
  });
  if (attachment.mediaType?.startsWith("image/"))
    return <TelegramInlineImage attachment={attachment} />;
  if (!playbackMode)
    return (
      <Typography.Text style={{ overflowWrap: "anywhere" }}>
        {telegramDownloadName(attachment)}
      </Typography.Text>
    );
  if (convert) {
    const state = preview.data;
    if (!preview.error && state?.status === "READY" && state.manifestUrl)
      return (
        <AuthenticatedHlsVideo
          manifestUrl={state.manifestUrl}
          mediaId={attachment.id}
          width="100%"
        />
      );
    return (
      <Alert
        type={
          preview.error ||
          ["FAILED", "EXPIRED", "CANCELLED"].includes(state?.status ?? "")
            ? "error"
            : "info"
        }
        title={
          preview.error?.message ?? state?.statusMessage ?? "正在转换兼容视频…"
        }
        action={
          <Button onClick={() => setConvert(false)}>
            {nativeVideo ? "返回原视频" : "返回附件"}
          </Button>
        }
      />
    );
  }
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {!nativeVideo ? (
        <Alert
          type="info"
          title="此视频需要转换为浏览器兼容格式"
          description={telegramDownloadName(attachment)}
        />
      ) : ticket.data?.url ? (
        <video
          key={ticket.data.url}
          src={ticket.data.url}
          controls
          playsInline
          preload="metadata"
          aria-label={attachment.fileName ?? "Telegram 视频"}
          onError={() => setPlaybackError(true)}
          onCanPlay={() => setPlaybackError(false)}
          onTimeUpdate={(event) => {
            if (restorePosition.current === null)
              playbackPosition.current = event.currentTarget.currentTime;
          }}
          onLoadedMetadata={(event) => {
            const savedPosition = restorePosition.current;
            if (savedPosition === null) return;
            const player = event.currentTarget;
            // A renewed stream ticket replaces the video element; preserve the user's place.
            player.currentTime = Number.isFinite(player.duration)
              ? Math.min(savedPosition, player.duration)
              : savedPosition;
            restorePosition.current = null;
          }}
          style={{
            display: "block",
            width: "100%",
            maxHeight: "60vh",
            background: "#111",
          }}
        />
      ) : ticket.isPending ? (
        <Spin />
      ) : null}
      {nativeVideo && (ticket.error || playbackError) ? (
        <Alert
          type="error"
          title={
            ticket.error?.message ?? "视频播放失败，可重新加载或转换为兼容格式"
          }
          action={
            <Button
              onClick={() => {
                restorePosition.current = playbackPosition.current;
                setPlaybackError(false);
                void ticket.refetch();
              }}
              loading={ticket.isFetching}
            >
              重新加载
            </Button>
          }
        />
      ) : null}
      {!nativeVideo || playbackError ? (
        <Button
          onClick={() => convertVideo.mutate()}
          loading={convertVideo.isPending}
        >
          转换兼容格式
        </Button>
      ) : null}
      {convertVideo.error ? (
        <Alert type="error" title={convertVideo.error.message} />
      ) : null}
    </Space>
  );
}
