import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Dropdown, Input, Skeleton } from "antd";
import {
  Headphones,
  Mail,
  MapPin,
  Phone,
  Search,
  ChevronRight,
  X,
  Eye,
  Sun,
  Moon,
  ChevronDown,
} from "lucide-react";
import { cleanRichText } from "./RichTextView";
import {
  channelHref,
  categoryPurpose,
  portalReturnPath,
  useSite,
  type SiteConfig,
} from "../lib/portal";
import type { Article } from "../types";
import { usePortalAppearance } from "../lib/appearance-context";
import { PortalFeedback } from "./PortalFeedback";

/** 客户门户使用独立栏目导航与主题；搜索保留所属栏目，访客没有后台跳转入口。 */
export function SiteFrame({
  children,
  activeChannelCode,
}: {
  children: ReactNode;
  activeChannelCode?: string;
}) {
  const { data: info } = useSite();
  const location = useLocation();
  const navigate = useNavigate();
  const appearance = usePortalAppearance();
  const search = (keyword: string) => {
    const next = new URLSearchParams(
      location.pathname.startsWith("/articles/") ? "" : location.search,
    );
    next.delete("page");
    if (keyword) next.set("q", keyword);
    else next.delete("q");
    const query = next.toString();
    navigate(
      (activeChannelCode ? channelHref(activeChannelCode) : "/") +
        (query ? "?" + query : ""),
    );
  };
  const hasContact = !!(info?.contact || info?.phone || info?.address);
  useEffect(() => {
    if (location.hash !== "#contact") return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById("contact");
      target?.scrollIntoView();
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);
  return (
    <div className="site-shell">
      <a className="site-skip" href="#site-main">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link to="/" aria-label="返回网站首页" className="site-brand">
            <span className="site-wordmark">{info?.name || "Mayday"}</span>
          </Link>
          <nav aria-label="网站导航">
            <Link
              to="/"
              aria-current={
                !activeChannelCode && location.pathname === "/"
                  ? "page"
                  : undefined
              }
            >
              <span>首页</span>
            </Link>
            {(info?.channels ?? []).slice(0, 4).map((channel) => (
              <Link
                key={channel.id}
                to={channelHref(channel.code)}
                title={channel.name}
                aria-current={
                  activeChannelCode === channel.code ? "page" : undefined
                }
              >
                <span>{channel.name}</span>
              </Link>
            ))}
            {(info?.channels.length ?? 0) > 4 && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: (info?.channels ?? []).slice(4).map((channel) => ({
                    key: channel.code,
                    label: (
                      <Link to={channelHref(channel.code)}>{channel.name}</Link>
                    ),
                  })),
                  selectedKeys: activeChannelCode ? [activeChannelCode] : [],
                }}
              >
                <Button
                  type="text"
                  className="site-nav-more"
                  aria-label="更多栏目"
                >
                  <span>
                    {(info?.channels ?? [])
                      .slice(4)
                      .find((channel) => channel.code === activeChannelCode)
                      ?.name ?? "更多"}
                  </span>
                  <ChevronDown size={14} />
                </Button>
              </Dropdown>
            )}
          </nav>
          <PortalSearch
            keyword={new URLSearchParams(location.search).get("q") ?? ""}
            onSearch={search}
          />
          {appearance.allowed && (
            <Button
              type="text"
              className="site-mode-toggle"
              aria-label={appearance.dark ? "切换浅色模式" : "切换暗夜模式"}
              title={appearance.dark ? "切换浅色模式" : "切换暗夜模式"}
              icon={appearance.dark ? <Sun size={18} /> : <Moon size={18} />}
              onClick={appearance.toggle}
            />
          )}
          {hasContact && (
            <Link
              to={location.pathname + location.search + "#contact"}
              className="site-contact-link"
            >
              <Headphones size={17} />
              联系支持
            </Link>
          )}
        </div>
      </header>
      {children}
      <footer className="site-footer" id="contact" tabIndex={-1}>
        <div className="site-container site-footer-row">
          <div className="site-footer-identity">
            <strong>{info?.name || "Mayday"}</strong>
            <span>
              {info?.copyright ||
                "© " +
                  new Date().getFullYear() +
                  " " +
                  (info?.name || "Mayday")}
              {info?.icp && " · " + info.icp}
            </span>
          </div>
          {hasContact && <ContactDetails info={info} />}
          <PortalFeedback />
        </div>
      </footer>
    </div>
  );
}

/** 公开页面统一提供可重试状态，避免把服务器诊断信息或后台操作建议直接展示给客户。 */
export function PortalState({
  loading,
  error,
  retry,
  children,
  message = "内容暂时无法加载，请稍后重试。",
}: {
  loading: boolean;
  error?: Error | null;
  retry?: () => void;
  children: ReactNode;
  message?: string;
}) {
  if (loading)
    return (
      <div className="site-loading" role="status" aria-label="正在加载内容">
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    );
  if (error)
    return (
      <div className="site-load-error">
        <Alert
          type="warning"
          showIcon
          title={message}
          action={
            retry && (
              <Button size="small" onClick={retry}>
                重新加载
              </Button>
            )
          }
        />
      </div>
    );
  return <>{children}</>;
}

/** 侧栏的公告、指南和相关阅读复用同一列表；仅展示真实公开内容，没有内容时不占位。 */
export function ArticleLinkList({
  title,
  articles,
  moreHref,
  thumbnails = false,
}: {
  title: string;
  articles: Article[];
  moreHref?: string;
  thumbnails?: boolean;
}) {
  const location = useLocation();
  if (!articles.length) return null;
  return (
    <section
      className={`site-link-section ${thumbnails ? "site-thumbnail-section" : ""}`}
    >
      <div className="site-aside-title">
        <h2>{title}</h2>
        {moreHref && (
          <Link to={moreHref} aria-label={`查看全部${title}`}>
            全部 <ChevronRight size={14} />
          </Link>
        )}
      </div>
      <ul>
        {articles.map((article) => (
          <li key={article.id}>
            <Link
              to={`/articles/${article.id}`}
              state={{
                from: !location.pathname.startsWith("/articles/")
                  ? `${location.pathname}${location.search}`
                  : portalReturnPath(location.state),
              }}
            >
              {thumbnails && <ArticleCover article={article} />}
              <span>{article.title}</span>
              {!thumbnails && <ChevronRight size={15} />}
            </Link>
            <time dateTime={article.createdAt}>
              {article.createdAt?.slice(0, 10)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 先执行共用富文本白名单，再添加本地生成的目录锚点；不信任正文携带的 ID、脚本或任意属性。 */
export function useArticleDocument(content: string) {
  return useMemo(() => {
    const document = new DOMParser().parseFromString(
      cleanRichText(content),
      "text/html",
    );
    const headings = Array.from(document.body.querySelectorAll("h2, h3")).map(
      (heading, index) => {
        heading.id = `article-section-${index + 1}`;
        heading.setAttribute("tabindex", "-1");
        return {
          id: heading.id,
          title: heading.textContent || "章节",
          level: heading.tagName === "H3" ? 3 : 2,
        };
      },
    );
    return { html: document.body.innerHTML, headings };
  }, [content]);
}

/** 仅展示后台配置的公开联系信息；空字段不占位，不拼接后台入口或内部参数。 */
export function ContactDetails({ info }: { info?: SiteConfig }) {
  return (
    <address className="site-contact-details">
      {info?.contact && (
        <a href={`mailto:${info.contact}`}>
          <Mail size={17} />
          <span>{info.contact}</span>
        </a>
      )}
      {info?.phone && (
        <a href={`tel:${info.phone.replace(/[^+\d*#;,]/g, "")}`}>
          <Phone size={17} />
          <span>{info.phone}</span>
        </a>
      )}
      {info?.address && (
        <span>
          <MapPin size={17} />
          <span>{info.address}</span>
        </span>
      )}
    </address>
  );
}

/** 搜索内容与 URL 同步；回退、分类跳转及清空操作不会残留输入框里的旧关键词。 */
export function PortalSearch({
  keyword,
  onSearch,
}: {
  keyword: string;
  onSearch: (value: string) => void;
}) {
  const [input, setInput] = useState(keyword);
  useEffect(() => setInput(keyword), [keyword]);
  return (
    <form
      className="site-search"
      role="search"
      aria-label="站内内容搜索"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(input.trim());
      }}
    >
      <Input
        aria-label="搜索文章标题"
        placeholder="搜索内容"
        value={input}
        maxLength={120}
        onChange={(event) => setInput(event.target.value)}
        allowClear={{ clearIcon: <X size={14} aria-label="清空搜索" /> }}
        onClear={() => onSearch("")}
      />
      <Button htmlType="submit" aria-label="搜索" icon={<Search size={17} />} />
    </form>
  );
}

/** 列表与侧栏共用封面规则，首页精选可以选择更适合横向裁切的缺省摄影。
 * 后台配置的封面始终优先，只有缺省/失败时才使用模板照片；不改变文章内容或分类。
 * 图片占位比例固定，加载失败回退，避免卡片跳动。 */
export function ArticleCover({
  article,
  featured = false,
}: {
  article: Article;
  featured?: boolean;
}) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const kind =
    { GUIDE: "guide", NOTICE: "notice", UPDATE: "update", STORY: "topic" }[
      article.channelTemplate
    ] ?? categoryPurpose(article.category ?? "").kind;
  const cover =
    article.coverUrl && failedCover !== article.coverUrl
      ? article.coverUrl
      : `/images/${{ guide: featured ? "portal-hero-refined.png" : "portal-redesign-hero.png", notice: "portal-notice.webp", update: "portal-update.webp", topic: featured ? "portal-team-board.png" : "portal-redesign-team.png" }[kind]}`;
  return (
    <img
      src={cover}
      alt=""
      loading="lazy"
      decoding="async"
      width={1200}
      height={570}
      onError={() => {
        if (article.coverUrl) setFailedCover(article.coverUrl);
      }}
    />
  );
}

/** 内容卡片沿用教程目录的紧凑结构：主题封面、标题、摘要、分类与日期。
 * 真实封面、标题和分类均来自公开接口；推荐角标仅由后台推荐/置顶状态触发。 */
export function ArticleTeaser({
  article,
  featured = false,
}: {
  article: Article;
  featured?: boolean;
}) {
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;
  return (
    <article
      className={`site-article-row ${featured ? "site-article-featured" : ""}`}
    >
      <Link
        to={`/articles/${article.id}`}
        state={{ from }}
        tabIndex={-1}
        aria-hidden="true"
        className="site-row-cover"
      >
        <ArticleCover article={article} />
        {(article.pinned || featured || article.recommended) && (
          <span className="site-cover-badge">
            {article.pinned ? "置顶" : "推荐"}
          </span>
        )}
      </Link>
      <div className="site-row-body">
        <h3>
          <Link to={`/articles/${article.id}`} state={{ from }}>
            {article.title}
          </Link>
        </h3>
        {article.summary && <p>{article.summary}</p>}
        <div className="site-card-footer">
          <Link
            to={channelHref(article.channelCode, article.categoryId)}
            className="site-card-category"
          >
            {article.category || "未分类"}
          </Link>
          <time dateTime={article.createdAt}>
            {article.createdAt?.slice(0, 10)}
          </time>
          <span aria-label={`${article.viewCount} 次浏览`}>
            <Eye size={14} aria-hidden="true" />
            {article.viewCount}
          </span>
        </div>
      </div>
    </article>
  );
}
