import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  Bell,
  Newspaper,
  Users,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { ArticleCover } from "./Portal";
import { channelHref, type PortalChannel } from "../lib/portal";
import type { Article } from "../types";

/** 栏目图标与模板一一对应，不通过名称猜测业务类型；新增栏目复用相同模板组件。 */
export const channelIcons = {
  GUIDE: BookOpen,
  NOTICE: Bell,
  UPDATE: Newspaper,
  STORY: Users,
};

/** 可点击文章标题统一保留当前检索上下文；详情无需增加重复的返回按钮。 */
export function PortalArticleLink({
  article,
  children,
  className,
}: {
  article: Article;
  children?: React.ReactNode;
  className?: string;
}) {
  const location = useLocation();
  return (
    <Link
      to={`/articles/${article.id}`}
      state={{ from: location.pathname + location.search }}
      className={className}
    >
      {children ?? article.title}
    </Link>
  );
}

/** 主视觉使用受管封面或实际摄影资产；标题和摘要属于界面文本，图片不承载可操作按钮。 */
export function PortalHero({
  article,
  channel,
}: {
  article?: Article | null;
  channel?: PortalChannel;
}) {
  const fallback = `/images/${channel ? { GUIDE: "portal-guide.webp", NOTICE: "portal-notice.webp", UPDATE: "portal-update.webp", STORY: "portal-redesign-team.png" }[channel.template] : "portal-redesign-hero.png"}`;
  const requested = article?.coverUrl ?? fallback;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  // 文章下线或封面失效时保留栏目主视觉；更换文章后会重新尝试其实际封面。
  const src = failedSource === requested ? fallback : requested;
  return (
    <section
      className={`customer-hero ${channel ? "portal-channel-hero" : ""}`}
    >
      <div className="customer-hero-copy">
        <h1>{channel?.name ?? article?.title ?? "使用帮助与服务信息"}</h1>
        <p>
          {channel?.description ??
            article?.summary ??
            "查看使用指南、公告与产品更新。"}
        </p>
        {article && !channel && (
          <PortalArticleLink article={article} className="portal-primary-link">
            阅读内容 <ArrowRight size={17} />
          </PortalArticleLink>
        )}
      </div>
      <img
        src={src}
        alt=""
        width={1881}
        height={836}
        className="customer-hero-image"
        fetchPriority="high"
        onError={() => {
          if (requested !== fallback) setFailedSource(requested);
        }}
      />
    </section>
  );
}

/** 首页快捷入口读取启用栏目；最多显示三个非公告入口，公告使用单独的信息条。 */
export function PortalChannelEntries({
  channels,
}: {
  channels: PortalChannel[];
}) {
  return (
    <div className="portal-channel-entries">
      {channels
        .filter((channel) => channel.template !== "NOTICE")
        .slice(0, 3)
        .map((channel) => {
          const Icon = channelIcons[channel.template];
          return (
            <Link
              key={channel.id}
              to={channelHref(channel.code)}
              className="portal-channel-entry"
            >
              <Icon size={26} />
              <div>
                <h2>{channel.name}</h2>
                <p>{channel.description}</p>
                <span>
                  浏览内容 <ArrowRight size={15} />
                </span>
              </div>
            </Link>
          );
        })}
    </div>
  );
}

/** 通知条只展示已公开公告，不把后台通知、审批消息混入访客页面。 */
export function PortalNoticeStrip({ article }: { article?: Article | null }) {
  if (!article) return null;
  return (
    <div className="portal-notice-strip">
      <Bell size={17} />
      <span className="portal-notice-label">
        {article.pinned ? "重要公告" : "最新公告"}
      </span>
      <PortalArticleLink article={article} />
      <time dateTime={article.createdAt}>
        {article.createdAt?.slice(0, 10)}
      </time>
      <ChevronRight size={16} />
    </div>
  );
}

/** 图文卡片复用同一封面比例与真实状态；主题切换不改变内容大小、布局和分页。 */
export function PortalArticleCard({ article }: { article: Article }) {
  return (
    <article className="portal-content-card">
      <PortalArticleLink article={article} className="portal-card-image">
        <ArticleCover article={article} />
      </PortalArticleLink>
      <div className="portal-card-copy">
        <Link
          to={channelHref(article.channelCode, article.categoryId)}
          className="portal-category-label"
        >
          {article.category}
        </Link>
        <h3>
          <PortalArticleLink article={article} />
        </h3>
        {article.summary && <p>{article.summary}</p>}
        <time dateTime={article.createdAt}>
          {article.createdAt?.slice(0, 10)}
        </time>
      </div>
    </article>
  );
}
