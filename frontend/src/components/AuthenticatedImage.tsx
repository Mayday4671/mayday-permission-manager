import { useEffect, useState } from "react";
import { Alert, Spin } from "antd";
import { tokenStore } from "../lib/api";

/** 私有图片通过鉴权请求变成短期 Blob URL，令牌不拼入 URL；切换版本或卸载时撤销旧资源。 */
export function AuthenticatedImage({
  endpoint,
  alt,
}: {
  endpoint: string;
  alt: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    fetch(`/api${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenStore.get()}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("加载失败");
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
  }, [endpoint]);
  return failed ? (
    <Alert type="warning" title="封面无法加载" />
  ) : url ? (
    <img className="content-cover-preview" src={url} alt={alt} />
  ) : (
    <Spin />
  );
}
