import { useEffect, useRef } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Empty, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Eye, FileDown } from "lucide-react";
import {
  ArticleCover,
  ArticleLinkList,
  PortalState,
  useArticleDocument,
  ContactDetails,
  SiteFrame,
} from "../components/Portal";
import { api, ApiError } from "../lib/api";
import {
  channelHref,
  legacyCategoryHref,
  positiveInteger,
  useSeo,
  useSite,
} from "../lib/portal";
import { PortalHomePage } from "./PortalHomePage";
import { PortalChannelPage } from "./PortalChannelPage";
import type { Article, PageResult } from "../types";
import "../portal.css";

/** 旧分类地址仅做书签迁移；实际栏目由后台登记，禁止把分类直接变成导航或详情入口。 */
function LegacyCategoryPage() {
  const { categoryId } = useParams();
  const location = useLocation();
  const site = useSite();
  const id = positiveInteger(categoryId);
  const channel = site.data?.channels.find((c) =>
    c.categories.some((category) => category.id === id),
  );
  if (channel) {
    const params = new URLSearchParams(location.search);
    params.set("category", String(id));
    return (
      <Navigate
        replace
        to={channelHref(channel.code) + "?" + params.toString()}
      />
    );
  }
  return (
    <SiteFrame>
      <main id="site-main" className="site-container site-empty">
        <PortalState
          loading={site.isLoading}
          error={site.error}
          retry={() => void site.refetch()}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该分类不存在或暂未开放"
          />
        </PortalState>
      </main>
    </SiteFrame>
  );
}

/** 首页、检索及旧书签分别进入专用组件；栏目页由独立路由渲染，首页不模拟可清除的栏目筛选。 */
export function PortalPage() {
  const location = useLocation();
  const legacy =
    location.pathname === "/" ? legacyCategoryHref(location.search) : null;
  if (legacy) return <Navigate replace to={legacy} />;
  if (location.pathname.startsWith("/categories/"))
    return <LegacyCategoryPage />;
  const params = new URLSearchParams(location.search);
  return params.has("q") || params.has("tag") ? (
    <PortalChannelPage searchOnly />
  ) : (
    <PortalHomePage />
  );
}

/** 详情只读取当前公开版本，直接呈现标题与正文；栏目跳转统一使用顶部导航，404 单独提供恢复入口。 */
export function ArticlePage() {
  const { id } = useParams();
  const site = useSite();
  const article = useQuery({
    queryKey: ["public", "article", id],
    queryFn: ({ signal }) => api<Article>(`/public/articles/${id}`, { signal }),
    refetchInterval: 30000,
    retry: false,
  });
  const item = article.data;
  const document = useArticleDocument(item?.content ?? "");
  const related = useQuery({
    queryKey: ["public", "related", item?.categoryId],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?categoryId=${item!.categoryId}&size=4`,
        { signal },
      ),
    enabled: !!item && !article.isError,
    refetchInterval: 30000,
  });
  const client = useQueryClient();
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!item || article.isError || counted.current === id) return;
    counted.current = id ?? null;
    void api<number>(`/public/articles/${id}/view`, { method: "POST" })
      .then((count) =>
        client.setQueryData<Article>(["public", "article", id], (previous) =>
          previous ? { ...previous, viewCount: count } : previous,
        ),
      )
      .catch(() => {});
  }, [id, item, article.isError, client]);
  useSeo(
    item && !article.isError
      ? `${item.seoTitle || item.title} · ${site.data?.name || "Mayday"}`
      : "内容详情",
    item?.seoDescription || item?.summary || "",
    item?.seoKeywords || site.data?.keywords || "",
  );
  const unavailable =
    article.error instanceof ApiError && article.error.status === 404;
  return (
    <SiteFrame
      activeChannelCode={!article.isError ? item?.channelCode : undefined}
    >
      <main
        id="site-main"
        tabIndex={-1}
        className="site-container site-article-container"
      >
        {unavailable ? (
          <div className="site-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="这篇内容已下线或不存在"
            />
            <Link to="/" className="site-inline-link">
              浏览其他内容 <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <PortalState
            loading={article.isLoading}
            error={article.error}
            retry={() => void article.refetch()}
          >
            {item && (
              <div className="site-reading-layout">
                <article className="site-article">
                  <h1>{item.title}</h1>
                  <div className="site-article-meta">
                    <span>{item.authorName}</span>
                    <time dateTime={item.createdAt}>
                      <CalendarDays size={15} />
                      {item.createdAt?.slice(0, 10)}
                    </time>
                    <span>
                      <Eye size={15} />
                      {item.viewCount} 次浏览
                    </span>
                  </div>
                  {item.summary && (
                    <p className="site-article-summary">{item.summary}</p>
                  )}
                  <div className="site-article-cover">
                    <ArticleCover article={item} />
                  </div>
                  <div
                    className="site-reading-body rich-text-content"
                    dangerouslySetInnerHTML={{ __html: document.html }}
                  />
                  {!!item.tags.length && (
                    <div className="site-article-tags">
                      {item.tags.map((tag) => (
                        <Link key={tag.id} to={`/?tag=${tag.id}`}>
                          <Tag>{tag.name}</Tag>
                        </Link>
                      ))}
                    </div>
                  )}
                  {!!item.attachments?.length && (
                    <section className="site-article-files">
                      <h2>附件下载</h2>
                      {item.attachments.map((file) => (
                        <a href={file.url} key={file.id} download={file.name}>
                          <FileDown size={17} />
                          <span>{file.name}</span>
                          <small>{(file.size / 1024).toFixed(1)} KB</small>
                        </a>
                      ))}
                    </section>
                  )}
                </article>
                <aside className="site-reading-aside" aria-label="文章导航">
                  {!!document.headings.length && (
                    <nav className="site-outline" aria-label="本页目录">
                      <h2>本页目录</h2>
                      {document.headings.map((heading) => (
                        <a
                          key={heading.id}
                          href={`#${heading.id}`}
                          className={
                            heading.level === 3
                              ? "site-outline-child"
                              : undefined
                          }
                          onClick={() =>
                            window.document
                              .getElementById(heading.id)
                              ?.focus({ preventScroll: true })
                          }
                        >
                          {heading.title}
                        </a>
                      ))}
                    </nav>
                  )}
                  {!related.isError && (
                    <ArticleLinkList
                      title="相关阅读"
                      articles={(related.data?.items ?? []).filter(
                        (value) => value.id !== item.id,
                      )}
                      moreHref={channelHref(item.channelCode, item.categoryId)}
                    />
                  )}
                  {(site.data?.contact ||
                    site.data?.phone ||
                    site.data?.address) && (
                    <section className="site-support">
                      <h2>联系支持</h2>
                      <ContactDetails info={site.data} />
                    </section>
                  )}
                </aside>
              </div>
            )}
          </PortalState>
        )}
      </main>
    </SiteFrame>
  );
}
