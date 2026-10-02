import { useEffect, useState } from "react";
import { Empty, Skeleton } from "antd";
import { ImageIcon } from "lucide-react";
import { tokenStore } from "../lib/api";
import type { FileRecord } from "../types/operations";
import "./file-image.css";

/**
 * 鉴权图片通过 Bearer 请求取 Blob，不把令牌拼入 URL。
 * 文件、模式或组件生命周期变化时撤销临时 URL，避免翻页或切换账户留下图片缓存。
 */
export function FileImage({
  file,
  thumbnail = false,
}: {
  file: FileRecord;
  thumbnail?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const image = /\.(png|jpe?g|webp)$/i.test(file.name);
  useEffect(() => {
    setUrl(undefined);
    setFailed(false);
    if (!image) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(
      `/api/operations/files/${file.id}/${thumbnail ? "thumbnail" : "preview"}`,
      {
        headers: { Authorization: `Bearer ${tokenStore.get()}` },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(thumbnail ? 20_000 : 60_000),
        ]),
      },
    )
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get("Content-Type")?.startsWith("image/")
        )
          throw new Error("图片读取失败");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, image, thumbnail]);
  if (!image || failed)
    return thumbnail ? (
      <ImageIcon size={20} aria-hidden="true" />
    ) : (
      <Empty description="图片无法读取，请检查权限或下载原文件" />
    );
  if (!url)
    return thumbnail ? (
      <Skeleton.Avatar active shape="square" size={32} />
    ) : (
      <Skeleton.Image active />
    );
  return (
    <img
      src={url}
      alt={file.name}
      className={thumbnail ? "file-image-thumbnail" : "file-image-preview"}
    />
  );
}
