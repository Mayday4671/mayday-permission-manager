import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Input, Skeleton } from "antd";
import {
  Headphones,
  Mail,
  MapPin,
  Phone,
  Search,
  ChevronRight,
  X,
  Eye,
} from "lucide-react";
import { cleanRichText } from "./RichTextView";
import {
  categoryHref,
  categoryPurpose,
  portalReturnPath,
  useSite,
  useTaxonomy,
  type SiteConfig,
} from "../lib/portal";
import type { Article } from "../types";

/** 公共网站使用独立主题范围，阅读字号和触控尺寸不会影响后台表格密度。 */
export function SiteFrame({
  children,
  activeCategoryId,
}: {
  children: ReactNode;
  activeCategoryId?: number;
}) {
  const { data: info } = useSite();
  const { data: taxonomy } = useTaxonomy();
  const location = useLocation();
  const navigate = useNavigate();
  const activeCategory = activeCategoryId ? String(activeCategoryId) : null;
  const params = new URLSearchParams(location.search);
  const search = (keyword: string) => {
    // 栏目内搜索仍停留在该栏目，文章详情的搜索则进入其所属栏目。
    const next = new URLSearchParams(
      location.pathname.startsWith("/articles/") ? "" : location.search,
    );
    next.delete("page");
    next.delete("category");
    if (keyword) next.set("q", keyword);
    else next.delete("q");
    const query = next.toString();
    navigate(
      `${activeCategoryId ? categoryHref(activeCategoryId) : "/"}${query ? `?${query}` : ""}`,
    );
  };
  const primary = [...(taxonomy?.categories ?? [])].sort(
    (a, b) => categoryPurpose(a.name).order - categoryPurpose(b.name).order,
  );
  const hasContact = !!(info?.contact || info?.phone || info?.address);
  // React 路由切换不重新加载文档；显式处理页脚锚点，让详情页的联系入口也能准确定位。
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
              aria-current={location.pathname === "/" ? "page" : undefined}
            >
              首页
            </Link>
            {primary.map((category) => (
              <Link
                key={category.id}
                to={categoryHref(category.id)}
                aria-current={
                  activeCategory === String(category.id) ? "page" : undefined
                }
              >
                {category.name}
              </Link>
            ))}
          </nav>
          <PortalSearch keyword={params.get("q") ?? ""} onSearch={search} />
          {hasContact && (
            <Link
              to={`${location.pathname}${location.search}#contact`}
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
                `© ${new Date().getFullYear()} ${info?.name || "Mayday"}`}
              {info?.icp && <> · {info.icp}</>}
            </span>
          </div>
          {hasContact && <ContactDetails info={info} />}
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

/** 列表与侧栏使用同一封面规则。优先显示后台配置的图片；缺省图片只表达内容类别，
 * 不虚构文章信息。各分类封面使用固定比例，图片失败时回退，避免破图造成卡片跳动。 */
function ArticleCover({ article }: { article: Article }) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const kind = categoryPurpose(article.category ?? "").kind;
  const cover =
    article.coverUrl && failedCover !== article.coverUrl
      ? article.coverUrl
      : `/images/portal-${kind}-topic.webp`;
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
            to={categoryHref(article.categoryId)}
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
