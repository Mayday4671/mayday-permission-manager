import { useEffect, useRef, useState } from "react";
import { Alert, Button, Space } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { tokenStore } from "../../lib/api";
import type { TelegramCollectedMedia } from "./telegram-media-types";

/** 未命名的 Telegram 照片按实际媒体类型补扩展名，不使用 URL 或远端路径作文件名。 */
export function telegramDownloadName(attachment: TelegramCollectedMedia) {
  const extension: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
    "application/zip": "zip",
  };
  const supplied = attachment.fileName?.split(/[\\/]/).at(-1)?.trim();
  return (
    supplied?.replace(/[\x00-\x1f<>:"|?*]/g, "_") ||
    `telegram-${attachment.id}.${extension[attachment.mediaType ?? ""] ?? "bin"}`
  );
}

/** 仅在点击后读取私有附件；验证完整字节数后交给浏览器保存，关闭或取消会中止请求。 */
export function TelegramAttachmentDownload({
  attachment,
}: {
  attachment: TelegramCollectedMedia;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const download = async () => {
    if (request.current || !attachment.contentUrl) return;
    const controller = new AbortController();
    request.current = controller;
    setDownloading(true);
    setError(undefined);
    try {
      const token = tokenStore.get();
      const response = await fetch(attachment.contentUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(120000),
        ]),
      });
      if (response.status === 401)
        throw new Error("登录已过期，请重新登录后下载");
      if (response.status === 403) throw new Error("当前账号没有附件下载权限");
      if (response.status === 404)
        throw new Error("附件已被清理或删除，请重新读取原消息");
      if (response.status !== 200) throw new Error("附件下载失败，请重试");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (
        !blob.size ||
        (attachment.actualSize != null && blob.size !== attachment.actualSize)
      )
        throw new Error("附件内容不完整，请重新下载");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = telegramDownloadName(attachment);
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        // 保留短暂缓冲时间，避免浏览器尚未接管下载就释放对象地址。
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error && cause.name === "TimeoutError"
            ? "附件下载超时，请重试"
            : cause instanceof Error
              ? cause.message
              : "附件下载失败，请重试",
        );
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  };

  if (attachment.status !== "AVAILABLE" || !attachment.contentUrl) return null;
  return (
    <Space orientation="vertical" size={6}>
      <Space wrap>
        <Button
          icon={<DownloadOutlined aria-hidden />}
          loading={downloading}
          onClick={() => void download()}
        >
          下载文件
        </Button>
        {downloading ? (
          <Button
            onClick={() => {
              request.current?.abort();
              request.current = null;
              setDownloading(false);
            }}
          >
            取消下载
          </Button>
        ) : null}
      </Space>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Space>
  );
}
