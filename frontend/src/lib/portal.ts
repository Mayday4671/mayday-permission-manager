import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useModules } from "./modules";
import type { Appearance } from "./theme-model";

export interface SiteConfig {
  theme?: Appearance;
  name: string;
  contact: string;
  description: string;
  seoTitle: string;
  keywords: string;
  phone: string;
  address: string;
  copyright: string;
  icp: string;
  categories: string[];
}
export interface PublicCategory {
  id: number;
  name: string;
}
export interface Taxonomy {
  categories: PublicCategory[];
  tags: PublicCategory[];
}

/** 首页、详情与页脚共享缓存，只读取公开白名单；后台更改会在 30 秒内重新获取。 */
export function useSite(enabled = true) {
  const modules = useModules();
  return useQuery({
    queryKey: ["site"],
    enabled: enabled && modules.portal === true,
    queryFn: ({ signal }) => api<SiteConfig>("/public/site", { signal }),
    refetchInterval: 30000,
  });
}
export function useTaxonomy() {
  return useQuery({
    queryKey: ["public", "taxonomy"],
    queryFn: ({ signal }) => api<Taxonomy>("/public/taxonomy", { signal }),
    refetchInterval: 30000,
  });
}

/** 类型只决定栏目入口顺序与默认配图，不改变后台分类名称、ID 或文章的公开范围。自定义分类也有可用入口。 */
export function categoryPurpose(name: string) {
  if (/指南|帮助|教程|入门/.test(name))
    return { kind: "guide", hint: "查找操作步骤与使用说明", order: 0 };
  if (/公告|通知/.test(name))
    return { kind: "notice", hint: "查看服务通知与重要事项", order: 1 };
  if (/更新|动态|版本/.test(name))
    return { kind: "update", hint: "了解新功能与近期变化", order: 2 };
  return { kind: "topic", hint: `浏览${name}相关内容`, order: 3 };
}
export {
  categoryHref,
  positiveInteger,
  portalReturnPath,
  legacyCategoryHref,
} from "./portal-routing";

export function useSeo(title: string, description: string, keywords: string) {
  useEffect(() => {
    document.title = title;
    const cleanups: Array<() => void> = [];
    for (const [name, content] of [
      ["description", description],
      ["keywords", keywords],
    ]) {
      let meta = document.querySelector<HTMLMetaElement>(
        `meta[name="${name}"]`,
      );
      const existed = !!meta,
        old = meta?.content;
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = name;
        document.head.append(meta);
      }
      meta.content = content;
      const target = meta;
      cleanups.push(() => {
        if (existed) target.content = old ?? "";
        else target.remove();
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [title, description, keywords]);
}
