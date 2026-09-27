import { useEffect, useRef, useState } from "react";
import { Button, Image, Spin } from "antd";
import { ImageOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { readCrawlImage } from "../lib/crawler-images";

/** 预览与缩略图共用鉴权缓存；Blob 地址只在组件存活期间持有，切图后不短暂显示上一张。 */
function useImage(task: number, item: number | undefined, enabled: boolean) {
  const { can } = useAuth();
  const allowed = can("crawler:download");
  const query = useQuery({
    queryKey: ["crawler-image", task, item],
    queryFn: ({ signal }) => readCrawlImage(task, item!, signal),
    enabled: allowed && enabled && !!item,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const [object, setObject] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!query.data || !allowed) return;
    const url = URL.createObjectURL(query.data.blob);
    setObject({ blob: query.data.blob, url });
    return () => URL.revokeObjectURL(url);
  }, [query.data, allowed]);
  return {
    ...query,
    allowed,
    url: allowed && object?.blob === query.data?.blob ? object?.url : undefined,
  };
}

/** 列表与抽屉只加载视区附近的图片，长图集仍完整列出所有缩略图位置。 */
export function CollectedImage({
  task,
  item,
  alt,
  cover = false,
}: {
  task: number;
  item?: number;
  alt: string;
  cover?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const image = useImage(task, item, visible);
  return (
    <div
      ref={element}
      className={cover ? "crawl-article-cover" : "crawl-article-picture"}
    >
      {image.url ? (
        <img src={image.url} alt={alt} loading="lazy" />
      ) : (
        <div className="crawl-image-placeholder">
          {image.isFetching ? <Spin size="small" /> : <ImageOff size={24} />}
          <span>
            {!image.allowed
              ? "无图片查看权限"
              : image.error
                ? "图片读取失败"
                : item
                  ? "正在加载"
                  : "暂无配图"}
          </span>
        </div>
      )}
    </div>
  );
}

const placeholder =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";

/** 完整图片序列参与预览，而非仅注册已滚入视区的图片；切换时通过鉴权接口按需加载原图。 */
export function CrawlImageViewer({
  task,
  pictures,
  initial,
  close,
}: {
  task: number;
  pictures: { id: number }[];
  initial: number;
  close: () => void;
}) {
  const [current, setCurrent] = useState(initial);
  const image = useImage(task, pictures[current]?.id, true);
  return (
    <Image.PreviewGroup
      items={pictures.map((picture, index) => ({
        src: current === index && image.url ? image.url : placeholder,
        alt: `图片 ${index + 1}`,
        key: picture.id,
      }))}
      preview={{
        open: true,
        current,
        onChange: setCurrent,
        zIndex: 1400,
        onOpenChange: (open) => {
          if (!open) close();
        },
        countRender: (index, total) => `${index} / ${total}`,
        imageRender: (node) =>
          image.url ? (
            node
          ) : (
            <div className="crawl-viewer-loading">
              {image.error ? (
                <>
                  <span>图片读取失败</span>
                  <Button onClick={() => void image.refetch()}>重试</Button>
                </>
              ) : (
                <Spin />
              )}
            </div>
          ),
      }}
    />
  );
}
