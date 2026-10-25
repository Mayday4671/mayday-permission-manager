import { useEffect, useRef, useState } from "react";
import { Button, Space, Typography } from "antd";
import Hls from "hls.js";
import { api, tokenStore } from "../../lib/api";
import { TelegramVideoPlayer } from "./TelegramVideoPlayer";

/** HLS 资源需要带后台 Bearer 会话；只允许从当前站点加载清单和分片。 */
export function AuthenticatedHlsVideo({
  manifestUrl,
  mediaId,
  width = 240,
}: {
  manifestUrl: string;
  mediaId: number;
  width?: number | string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [originalUrl, setOriginalUrl] = useState<string>();
  const [ticketPending, setTicketPending] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!Hls.isSupported()) {
      setError("当前浏览器未提供受支持的安全 HLS 播放能力");
      return;
    }

    const player = new Hls({
      xhrSetup: (request, url) => {
        const target = new URL(url, window.location.href);
        if (target.origin !== window.location.origin) {
          request.abort();
          return;
        }
        const token = tokenStore.get();
        if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      },
    });
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError("视频播放失败；请刷新任务状态后重试");
    });
    player.loadSource(manifestUrl);
    player.attachMedia(element);
    return () => player.destroy();
  }, [manifestUrl]);

  const openOriginal = async () => {
    setTicketPending(true);
    try {
      const ticket = await api<{ url: string }>(
        `/telegram/media/${mediaId}/stream-ticket`,
        { method: "POST" },
      );
      setOriginalUrl(ticket.url);
    } catch (ticketError) {
      setError(
        ticketError instanceof Error
          ? ticketError.message
          : "无法创建受权原视频访问链接",
      );
    } finally {
      setTicketPending(false);
    }
  };

  return (
    <Space
      direction="vertical"
      size={4}
      style={{ width }}
      className="telegram-hls-player"
    >
      <TelegramVideoPlayer videoRef={video} aria-label="Telegram 视频" />
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      {originalUrl ? (
        <a href={originalUrl} target="_blank" rel="noopener noreferrer">
          在新窗口打开原视频
        </a>
      ) : (
        <Button
          size="small"
          loading={ticketPending}
          onClick={() => void openOriginal()}
        >
          获取受权原视频链接
        </Button>
      )}
    </Space>
  );
}
