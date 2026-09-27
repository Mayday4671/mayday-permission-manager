import { useEffect, useRef } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button, Empty, Pagination, Select, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Eye, FileDown, SearchX } from "lucide-react";
import {
  ArticleTeaser,
  ArticleLinkList,
  PortalState,
  useArticleDocument,
  ContactDetails,
  SiteFrame,
} from "../components/Portal";
import { api, ApiError, queryString } from "../lib/api";
import {
  categoryHref,
  categoryPurpose,
  legacyCategoryHref,
  positiveInteger,
  useSeo,
  useSite,
  useTaxonomy,
} from "../lib/portal";
import type { Article, PageResult } from "../types";
import "../portal.css";

/** 兼容旧分类书签；新导航的栏目是独立路由，不能在首页用可清除的分类条件替代。 */
export function PortalPage() {
  const location = useLocation();
  const legacy =
    location.pathname === "/" ? legacyCategoryHref(location.search) : null;
  return legacy ? (
    <Navigate replace to={legacy} />
  ) : (
    <PortalCatalogue key={location.pathname} />
  );
}

/** 首页与栏目页共享内容网格，查询只读取当前栏目已公开的文章；搜索与分页保留在当前路由。 */
function PortalCatalogue() {
  const site = useSite();
  const taxonomy = useTaxonomy();
  const route = useParams();
  const [params, setParams] = useSearchParams();
  const keyword = params.get("q") ?? "";
  const categoryId = positiveInteger(route.categoryId);
  const tagId = positiveInteger(params.get("tag"));
  const page = positiveInteger(params.get("page"), 1)!;
  const filtered = !!(keyword || tagId);
  const showHome = route.categoryId === undefined;
  const resultsRef = useRef<HTMLElement>(null);
  const previousQuery = useRef(params.toString());
  const categories = [...(taxonomy.data?.categories ?? [])].sort(
    (a, b) => categoryPurpose(a.name).order - categoryPurpose(b.name).order,
  );
  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );
  const selectedTag = taxonomy.data?.tags.find((tag) => tag.id === tagId);
  // 无效、停用或已删除的栏目显示不可用状态，绝不省略 categoryId 后误查全部内容。
  const unavailable =
    !showHome && (!categoryId || (!!taxonomy.data && !selectedCategory));
  const ready = showHome || !!selectedCategory;
  const guide = categories.find(
    (category) => categoryPurpose(category.name).kind === "guide",
  );
  const noticeCategory = categories.find(
    (category) => categoryPurpose(category.name).kind === "notice",
  );
  const change = (values: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next);
  };
  const articles = useQuery({
    queryKey: ["public", "articles", keyword, categoryId, tagId, page, 12],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?${queryString({ keyword, categoryId, tagId, page, size: 12 })}`,
        { signal },
      ),
    refetchInterval: 30000,
    enabled: ready && !unavailable,
  });
  const recommended = useQuery({
    queryKey: ["public", "recommended", categoryId],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?${queryString({ recommended: true, categoryId, size: 1 })}`,
        {
          signal,
        },
      ),
    enabled: ready && !unavailable,
    refetchInterval: 30000,
  });
  const guides = useQuery({
    queryKey: ["public", "home-guides", guide?.id],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?categoryId=${guide!.id}&size=3`,
        { signal },
      ),
    enabled: ready && !unavailable && !!guide,
    refetchInterval: 30000,
  });
  const announcements = useQuery({
    queryKey: ["public", "home-notices", noticeCategory?.id],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?categoryId=${noticeCategory!.id}&size=3`,
        { signal },
      ),
    enabled: ready && !unavailable && !!noticeCategory,
    refetchInterval: 30000,
  });
  // 后台可能下线最后一页的文章。收到真实总数后回到有效页码，避免出现无法解释的空白末页。
  useEffect(() => {
    if (!articles.data || articles.isError) return;
    const lastPage = Math.max(1, Math.ceil(articles.data.total / 12));
    if (page > lastPage) {
      const next = new URLSearchParams(params);
      if (lastPage === 1) next.delete("page");
      else next.set("page", String(lastPage));
      setParams(next, { replace: true });
    }
  }, [articles.data, articles.isError, page, params, setParams]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  // 仅翻页定位结果；搜索回到页顶，自动轮询不打断阅读。
  // 自动轮询不改变 URL，因此不会抢走阅读中的滚动位置。
  useEffect(() => {
    if (previousQuery.current === params.toString()) return;
    const previousPage = new URLSearchParams(previousQuery.current).get("page");
    previousQuery.current = params.toString();
    if (params.get("page") && previousPage !== params.get("page")) {
      resultsRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [params]);
  useSeo(
    selectedCategory
      ? `${selectedCategory.name} · ${site.data?.name || "Mayday"}`
      : site.data?.seoTitle || `${site.data?.name || "Mayday"} · 客户服务中心`,
    site.data?.description ?? "",
    site.data?.keywords ?? "",
  );
  const featured = !recommended.isError
    ? recommended.data?.items[0]
    : undefined;
  const hasContact = !!(
    site.data?.contact ||
    site.data?.phone ||
    site.data?.address
  );
  const heading = keyword
    ? "搜索结果"
    : selectedCategory?.name || selectedTag?.name || "最近发布";
  if (unavailable)
    return (
      <SiteFrame>
        <main
          id="site-main"
          tabIndex={-1}
          className="site-container site-empty"
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该栏目不存在或暂未开放"
          />
          <Link to="/" className="site-inline-link">
            返回首页 <ArrowRight size={15} />
          </Link>
        </main>
      </SiteFrame>
    );
  return (
    <SiteFrame activeCategoryId={categoryId}>
      <main id="site-main" tabIndex={-1}>
        {taxonomy.isError && (
          <div className="site-container">
            <PortalState
              loading={false}
              error={taxonomy.error}
              retry={() => void taxonomy.refetch()}
              message="栏目暂时无法加载，请重试。"
            >
              {null}
            </PortalState>
          </div>
        )}
        <div className="site-container site-content-layout">
          <section
            className="site-results"
            ref={resultsRef}
            aria-labelledby="results-title"
            aria-busy={articles.isFetching}
          >
            <div className="site-results-heading">
              <div>
                <h1 id="results-title">{heading}</h1>
                <p role="status">
                  {articles.isLoading || (!ready && taxonomy.isLoading)
                    ? "正在查找内容…"
                    : articles.isError
                      ? "内容加载失败"
                      : keyword
                        ? `“${keyword}” · 找到 ${articles.data?.total ?? 0} 篇内容`
                        : `共 ${articles.data?.total ?? 0} 篇内容`}
                </p>
              </div>
              {!!taxonomy.data?.tags.length && (
                <Select
                  aria-label="按标签筛选"
                  placeholder="全部标签"
                  allowClear
                  value={tagId}
                  onChange={(value) => change({ tag: value, page: undefined })}
                  options={taxonomy.data.tags.map((tag) => ({
                    value: tag.id,
                    label: tag.name,
                  }))}
                />
              )}
            </div>
            {filtered && (
              <div className="site-active-filters" aria-label="当前筛选条件">
                {keyword && (
                  <Tag
                    closable
                    onClose={() => change({ q: undefined, page: undefined })}
                  >
                    关键词：{keyword}
                  </Tag>
                )}
                {tagId && (
                  <Tag
                    closable
                    onClose={() => change({ tag: undefined, page: undefined })}
                  >
                    标签：{selectedTag?.name ?? "未找到的标签"}
                  </Tag>
                )}
                <Button type="link" onClick={() => setParams({})}>
                  清除筛选
                </Button>
              </div>
            )}
            <PortalState
              loading={articles.isLoading || (!ready && taxonomy.isLoading)}
              error={!ready ? taxonomy.error : articles.error}
              retry={() =>
                void (!ready ? taxonomy.refetch() : articles.refetch())
              }
            >
              {articles.data?.items.length ? (
                <>
                  <div className="site-article-list">
                    {articles.data.items.map((article) => (
                      <ArticleTeaser key={article.id} article={article} />
                    ))}
                  </div>
                  {articles.data.total > 12 && (
                    <Pagination
                      className="site-pagination"
                      align="center"
                      current={page}
                      total={articles.data.total}
                      pageSize={12}
                      showSizeChanger={false}
                      onChange={(value) => change({ page: value })}
                    />
                  )}
                </>
              ) : (
                <div className="site-empty">
                  <SearchX size={36} aria-hidden="true" />
                  <h3>{filtered ? "没有找到匹配的内容" : "暂无已发布内容"}</h3>
                  <p>
                    {filtered
                      ? "试试更简短的标题关键词，或清除筛选后重新浏览。"
                      : "暂时没有可浏览的内容，请稍后再来。"}
                  </p>
                  <div>
                    {filtered && (
                      <Button type="primary" onClick={() => setParams({})}>
                        {selectedCategory ? "浏览本栏目" : "查看全部内容"}
                      </Button>
                    )}
                    {hasContact && (
                      <Link className="site-inline-link" to="/#contact">
                        联系支持 <ArrowRight size={15} />
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </PortalState>
          </section>
          <aside className="site-aside" aria-label="内容导航与帮助">
            {noticeCategory &&
              categoryId !== noticeCategory.id &&
              !announcements.isError && (
                <ArticleLinkList
                  title="最新公告"
                  articles={announcements.data?.items ?? []}
                  moreHref={categoryHref(noticeCategory.id)}
                />
              )}
            {guide && categoryId !== guide.id && !guides.isError && (
              <ArticleLinkList
                title={guide.name}
                articles={guides.data?.items ?? []}
                moreHref={categoryHref(guide.id)}
                thumbnails
              />
            )}
            {featured && (
              <section className="site-link-section site-recommended">
                <h2>推荐阅读</h2>
                <ArticleTeaser article={featured} featured />
              </section>
            )}
            {hasContact && (
              <section className="site-support">
                <h2>联系支持</h2>
                <ContactDetails info={site.data} />
              </section>
            )}
          </aside>
        </div>
        {site.isError && (
          <div className="site-container site-config-error">
            <PortalState
              loading={false}
              error={site.error}
              retry={() => void site.refetch()}
              children={null}
            />
          </div>
        )}
      </main>
    </SiteFrame>
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
      activeCategoryId={!article.isError ? item?.categoryId : undefined}
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
                  {item.coverUrl && (
                    <img
                      className="site-article-cover"
                      src={item.coverUrl}
                      alt=""
                    />
                  )}
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
                      moreHref={categoryHref(item.categoryId)}
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
