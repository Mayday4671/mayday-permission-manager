import { useEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import {
  FileOutlined,
  PictureOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import { tokenStore } from "../../lib/api";
import { formatTelegramFileSize } from "./telegram-file-size";

export interface ChannelMediaPreview {
  kind: string;
  fileName: string | null;
  size: number;
  width: number;
  height: number;
  durationSeconds: number;
  hasThumbnail: boolean;
}

/** Loads only visible thumbnails; original media stays behind the explicit preview action. */
export function TelegramChannelMediaCard({
  chatId,
  messageId,
  media,
  disabled,
  onOpen,
}: {
  chatId: string;
  messageId: string;
  media: ChannelMediaPreview;
  disabled: boolean;
  onOpen: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const video = ["VIDEO", "ANIMATION"].includes(media.kind);
  const photo = media.kind === "PHOTO";
  const visual = photo || video || media.hasThumbnail;
  const label = video ? "播放视频" : photo ? "查看图片" : "预览附件";
  const kindLabel =
    (
      {
        PHOTO: "图片",
        VIDEO: "视频",
        ANIMATION: "动图",
        DOCUMENT: "文件",
        AUDIO: "音频",
        VOICE: "语音",
      } as Record<string, string>
    )[media.kind] ?? "附件";
  const size = formatTelegramFileSize(media.size);
  const seconds = media.durationSeconds;
  const duration =
    seconds > 0
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "";
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSource(undefined);
    setError(undefined);
    if (!visible || !media.hasThumbnail) return;
    const controller = new AbortController();
    let url: string | undefined;
    const token = tokenStore.get();
    void (async () => {
      const response = await fetch(
        `/api/telegram/channels/${chatId}/messages/${messageId}/thumbnail`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30000),
          ]),
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 403 ? "没有读取权限" : "缩略图加载失败",
        );
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("缩略图格式无效");
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setSource(url);
    })().catch((cause: Error) => {
      if (!controller.signal.aborted)
        setError(
          cause.name === "TimeoutError" ? "缩略图加载超时" : cause.message,
        );
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [chatId, messageId, media.hasThumbnail, visible, attempt]);
  return (
    <div
      ref={container}
      className={`telegram-channel-media-card${visual ? " is-visual" : ""}`}
    >
      <button
        type="button"
        className="telegram-channel-media-open"
        aria-label={label}
        disabled={disabled}
        onClick={onOpen}
        style={
          visual
            ? {
                aspectRatio: String(
                  media.width && media.height
                    ? Math.max(0.65, Math.min(1.8, media.width / media.height))
                    : 1.6,
                ),
              }
            : undefined
        }
      >
        {source && !error ? (
          <img
            src={source}
            alt={media.fileName || (photo ? "频道图片" : "视频封面")}
            onError={() => setError("缩略图无法显示")}
          />
        ) : visual ? (
          <span className="telegram-channel-media-placeholder">
            {media.hasThumbnail && !error ? (
              <Spin />
            ) : photo ? (
              <PictureOutlined />
            ) : (
              <PlayCircleFilled />
            )}
            <span>
              {error ||
                (media.hasThumbnail ? "正在加载预览" : "原消息未提供封面")}
            </span>
          </span>
        ) : (
          <span className="telegram-channel-file-icon">
            {media.kind === "AUDIO" || media.kind === "VOICE" ? (
              <SoundOutlined />
            ) : (
              <FileOutlined />
            )}
          </span>
        )}
        {video && source && !error ? (
          <span className="telegram-channel-play">
            <PlayCircleFilled />
          </span>
        ) : null}
        {visual ? (
          <span className="telegram-channel-media-badges">
            <span>
              {[media.kind === "PHOTO" ? "图片" : video ? "视频" : "附件", size]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span>{duration}</span>
          </span>
        ) : (
          <span className="telegram-channel-file-info">
            <strong>
              {media.fileName || (media.kind === "VOICE" ? "语音消息" : "附件")}
            </strong>
            <small>
              {[kindLabel, size, duration].filter(Boolean).join(" · ")}
            </small>
          </span>
        )}
      </button>
      {error ? (
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => setAttempt((value) => value + 1)}
        >
          重试缩略图
        </Button>
      ) : null}
    </div>
  );
}
