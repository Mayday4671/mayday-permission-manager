import type { BaseRecord } from "./index";
export type PageMode = "SINGLE" | "NEXT" | "LINKS" | "TEMPLATE" | "CURSOR";
export interface CrawlPageRule {
  mode: PageMode;
  format: "HTML" | "JSON";
  selector: string;
  template: string;
  start: number;
  step: number;
  maxPages: number;
  nextPointer: string;
  detailsPointer: string;
  imagesPointer: string;
  urlPointer: string;
}
export interface CrawlRules {
  article?: CrawlArticleRule;
  entryUrl: string;
  enterDetails: boolean;
  list: CrawlPageRule;
  detail: CrawlPageRule;
  detailSelector: string;
  imageSelector: string;
  imageAttributes: string[];
  imageHosts: string[];
  maxDetails: number;
  maxImages: number;
  intervalMs: number;
}
export interface CrawlArticleRule {
  enabled: boolean;
  title: string;
  content: string;
  author: string;
  publishedAt: string;
}
export interface CrawlArticleCard {
  id: number;
  taskId: number;
  taskName: string;
  taskStatus: string;
  /** 整个任务的图片上限，不是当前文章的应有图片数量。 */
  imageLimit: number;
  title: string;
  summary: string;
  author: string;
  publishedAt: string;
  sourceUrl: string;
  collectedAt: string;
  pageCount: number;
  imageCount: number;
  pendingImages: number;
  failedImages: number;
  coverItemId?: number;
}
export interface CrawlArticleDetail {
  article: CrawlArticleCard;
  pages: { id: number; sourceUrl: string; body: string; truncated: boolean }[];
  images: { id: number; fileId: number; bytes: number }[];
  truncated: boolean;
}
export interface CrawlTask extends BaseRecord {
  name: string;
  ownerName: string;
  status: string;
  rules: CrawlRules;
  pageCount: number;
  imageCount: number;
  failedCount: number;
  totalBytes: number;
  lastError?: string;
}
export interface CrawlItem extends BaseRecord {
  kind: "LIST" | "DETAIL" | "IMAGE";
  status: string;
  url: string;
  sourceUrl?: string;
  title?: string;
  fileId?: number;
  bytes: number;
  attempts: number;
  error?: string;
}
export const crawlStates: Record<string, string> = {
  DRAFT: "草稿",
  QUEUED: "排队中",
  RUNNING: "采集中",
  PAUSED: "已停止",
  COMPLETED: "已完成",
  PARTIAL: "部分失败",
  LIMITED: "达到上限",
  FETCHING: "请求中",
  SUCCESS: "成功",
  FAILED: "失败",
  DUPLICATE: "重复图片",
  SKIPPED: "已跳过",
};
/** 每次创建独立对象，避免列表与详情配置或不同任务之间共享可变引用。 */
export function defaultCrawlRules(): CrawlRules {
  const page = (): CrawlPageRule => ({
    mode: "SINGLE",
    format: "HTML",
    selector: "a[rel=next]",
    template: "{url}?page={page}",
    start: 1,
    step: 1,
    maxPages: 10,
    nextPointer: "",
    detailsPointer: "/data/items",
    imagesPointer: "/data/images",
    urlPointer: "",
  });
  return {
    article: {
      enabled: true,
      title: "",
      content: "",
      author: "",
      publishedAt: "",
    },
    entryUrl: "",
    enterDetails: false,
    list: page(),
    detail: page(),
    detailSelector: ".list a",
    imageSelector: "img",
    imageAttributes: [
      "data-original",
      "data-src",
      "data-srcset",
      "srcset",
      "src",
    ],
    imageHosts: [],
    maxDetails: 20,
    maxImages: 50,
    intervalMs: 1500,
  };
}
