import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button, Empty, Pagination } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Pin } from "lucide-react";
import { PortalState, SiteFrame, ArticleCover } from "../components/Portal";
import {
  PortalHero,
  PortalArticleCard,
  PortalArticleLink,
} from "../components/PortalViews";
import { api, queryString } from "../lib/api";
import {
  positiveInteger,
  useSeo,
  useSite,
  type PortalChannel,
} from "../lib/portal";
import type { Article, PageResult } from "../types";

/** 月份分组沿用服务端发布时间排序；不创建虚构公告、版本号或常见问题。 */
function datedGroups(items: Article[]) {
  const groups = new Map<string, Article[]>();
  for (const article of items) {
    const month = article.createdAt?.slice(0, 7) ?? "未标注日期";
    groups.set(month, [...(groups.get(month) ?? []), article]);
  }
  return [...groups];
}

/** 指南直接呈现文章入口与摘要；栏目分类由后台自由命名，不硬编码“入门/常见问题”筛选。 */
function GuideContent({ items }: { items: Article[] }) {
  const first = items[0];
  return (
    <>
      <section className="portal-guide-intro">
        <div>
          <h2>
            <PortalArticleLink article={first} />
          </h2>
          <p>{first.summary}</p>
          {items.length > 1 && (
            <ol>
              {items.slice(1, 4).map((article) => (
                <li key={article.id}>
                  <PortalArticleLink article={article} />
                  <p>{article.summary}</p>
                </li>
              ))}
            </ol>
          )}
          <PortalArticleLink article={first} className="portal-primary-link">
            阅读指南 <ArrowRight size={16} />
          </PortalArticleLink>
        </div>
        <ArticleCover article={first} />
      </section>
      {items.length > 4 && (
        <div className="portal-guide-links">
          {items.slice(4).map((article) => (
            <PortalArticleLink article={article} key={article.id}>
              <span>{article.title}</span>
              <ChevronRight size={16} />
            </PortalArticleLink>
          ))}
        </div>
      )}
    </>
  );
}

/** 公告以日期、分类和置顶状态组织，只有后台实际置顶的文章使用重要信息区。 */
function NoticeContent({ items }: { items: Article[] }) {
  return (
    <div className="portal-notices">
      {items
        .filter((a) => a.pinned)
        .map((article) => (
          <article className="portal-pinned-notice" key={article.id}>
            <Pin size={18} />
            <div>
              <h2>
                <PortalArticleLink article={article} />
              </h2>
              <p>{article.summary}</p>
            </div>
            <time>{article.createdAt?.slice(0, 10)}</time>
          </article>
        ))}
      {datedGroups(items.filter((a) => !a.pinned)).map(([month, articles]) => (
        <section className="portal-dated-section" key={month}>
          <h2>{month.replace("-", " 年 ")} 月</h2>
          {articles.map((article) => (
            <article className="portal-dated-row" key={article.id}>
              <time dateTime={article.createdAt}>
                {article.createdAt?.slice(5, 10)}
              </time>
              <span className="portal-category-label">{article.category}</span>
              <div>
                <h3>
                  <PortalArticleLink article={article} />
                </h3>
                <p>{article.summary}</p>
              </div>
              <ChevronRight size={16} />
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

/** 产品动态使用发布文章的真实标题和时间轴，不将发布时间或分类拼成不存在的产品版本。 */
function UpdateContent({ items }: { items: Article[] }) {
  const first = items[0];
  return (
    <>
      <section className="portal-release-feature">
        <div>
          <span className="portal-category-label">{first.category}</span>
          <h2>
            <PortalArticleLink article={first} />
          </h2>
          <time>{first.createdAt?.slice(0, 10)}</time>
          <p>{first.summary}</p>
          <PortalArticleLink article={first} className="portal-primary-link">
            查看更新 <ArrowRight size={16} />
          </PortalArticleLink>
        </div>
        <ArticleCover article={first} />
      </section>
      {items.length > 1 && (
        <div className="portal-timeline">
          {datedGroups(items.slice(1)).map(([month, articles]) => (
            <section key={month}>
              <h2>{month.replace("-", " 年 ")} 月</h2>
              {articles.map((article) => (
                <article key={article.id}>
                  <time>{article.createdAt?.slice(5, 10)}</time>
                  <div>
                    <h3>
                      <PortalArticleLink article={article} />
                    </h3>
                    <p>{article.summary}</p>
                  </div>
                  <ChevronRight size={16} />
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** 团队故事的首屏采用杂志主图与侧栏摘录，后续条目采用统一图文卡片。 */
function StoryContent({ items }: { items: Article[] }) {
  return (
    <>
      <div
        className={`portal-story-feature ${items.length === 1 ? "portal-story-single" : ""}`}
      >
        <PortalArticleCard article={items[0]} />
        <div className="portal-story-aside">
          {items.slice(1, 3).map((article) => (
            <article key={article.id}>
              <PortalArticleLink
                article={article}
                className="portal-story-image"
                ariaLabel={`阅读：${article.title}`}
              >
                <ArticleCover article={article} />
              </PortalArticleLink>
              <div>
                <span className="portal-category-label">
                  {article.category}
                </span>
                <h3>
                  <PortalArticleLink article={article} />
                </h3>
                <p>{article.summary}</p>
                <time>{article.createdAt?.slice(0, 10)}</time>
              </div>
            </article>
          ))}
        </div>
      </div>
      {items.length > 3 && (
        <div className="portal-card-grid">
          {items.slice(3).map((article) => (
            <PortalArticleCard article={article} key={article.id} />
          ))}
        </div>
      )}
    </>
  );
}

/** 同一查询组件控制分页与错误边界，四种展示模板只负责排列真实文章；分类不得跨栏目查询。 */
export function PortalChannelPage({
  searchOnly = false,
}: {
  searchOnly?: boolean;
}) {
  const { channelCode } = useParams();
  const site = useSite();
  const channel = site.data?.channels.find((item) => item.code === channelCode);
  const [params, setParams] = useSearchParams();
  const categoryId = positiveInteger(params.get("category"));
  const page = positiveInteger(params.get("page"), 1)!;
  const tagId = positiveInteger(params.get("tag"));
  const keyword = params.get("q") ?? "";
  const categoryValid =
    !params.has("category") ||
    !!channel?.categories.some((c) => c.id === categoryId);
  const unavailable =
    !searchOnly && !!site.data && (!channel || !categoryValid);
  const result = useQuery({
    queryKey: [
      "public",
      "channel",
      channelCode,
      categoryId,
      tagId,
      keyword,
      page,
    ],
    queryFn: ({ signal }) =>
      api<PageResult<Article>>(
        `/public/articles?${queryString({ channel: channelCode, categoryId, tagId, keyword, page, size: 12 })}`,
        { signal },
      ),
    enabled: (searchOnly || !!channel) && !unavailable,
    refetchInterval: 30000,
  });
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [channelCode]);
  useEffect(() => {
    if (!result.data) return;
    const max = Math.max(1, Math.ceil(result.data.total / 12));
    if (page > max) {
      const next = new URLSearchParams(params);
      if (max === 1) next.delete("page");
      else next.set("page", String(max));
      setParams(next, { replace: true });
    }
  }, [result.data, page, params, setParams]);
  useSeo(
    `${searchOnly ? "搜索结果" : (channel?.name ?? "栏目")} · ${site.data?.name ?? "Mayday"}`,
    channel?.description ?? "",
    site.data?.keywords ?? "",
  );
  const change = (category?: number) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (category) next.set("category", String(category));
    else next.delete("category");
    setParams(next);
  };
  const items = result.data?.items ?? [];
  const templates: Record<
    PortalChannel["template"],
    React.ComponentType<{ items: Article[] }>
  > = {
    GUIDE: GuideContent,
    NOTICE: NoticeContent,
    UPDATE: UpdateContent,
    STORY: StoryContent,
  };
  const Template = channel ? templates[channel.template] : null;
  // 栏目已由主视觉提供一级标题；全站检索才使用独立一级标题，避免重复阅读入口。
  const SearchHeading = searchOnly ? "h1" : "h2";
  const searchTitle = keyword ? "搜索结果" : tagId ? "标签内容" : "全部内容";
  const clearKeyword = () => {
    const next = new URLSearchParams(params);
    next.delete("q");
    next.delete("page");
    setParams(next);
  };
  return (
    <SiteFrame activeChannelCode={channel?.code}>
      <main
        id="site-main"
        tabIndex={-1}
        className="site-container portal-channel-page"
      >
        <PortalState
          loading={site.isLoading}
          error={site.error}
          retry={() => void site.refetch()}
        >
          {unavailable ? (
            <div className="site-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该栏目或分类不存在，或已停用"
              />
              <Link to="/">返回首页</Link>
            </div>
          ) : (
            <>
              {channel && <PortalHero channel={channel} />}
              {channel && (
                <nav className="portal-category-tabs" aria-label="栏目内分类">
                  <button
                    type="button"
                    aria-pressed={!categoryId}
                    onClick={() => change()}
                  >
                    全部
                  </button>
                  {channel.categories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      aria-pressed={categoryId === category.id}
                      onClick={() => change(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </nav>
              )}
              {(searchOnly || keyword) && (
                <div className="portal-section-heading">
                  <SearchHeading>{searchTitle}</SearchHeading>
                  <p role="status" aria-live="polite">
                    {keyword ? `“${keyword}” · ` : ""}
                    {result.isPending
                      ? "正在查找内容"
                      : result.isError
                        ? "暂时无法读取结果"
                        : `${result.data?.total ?? 0} 篇内容`}
                  </p>
                </div>
              )}
              <PortalState
                loading={result.isLoading}
                error={result.error}
                retry={() => void result.refetch()}
              >
                {items.length ? (
                  searchOnly || keyword ? (
                    <div className="portal-card-grid">
                      {items.map((article) => (
                        <PortalArticleCard key={article.id} article={article} />
                      ))}
                    </div>
                  ) : (
                    Template && <Template items={items} />
                  )
                ) : (
                  <div className="site-empty">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        keyword
                          ? "未找到匹配内容，请尝试其他标题关键词"
                          : categoryId
                            ? "该分类暂时没有已发布内容"
                            : "暂时没有已发布内容"
                      }
                    />
                    {keyword && (
                      <Button onClick={clearKeyword}>清空关键词</Button>
                    )}
                  </div>
                )}
              </PortalState>
              {result.data && result.data.total > 12 && (
                <Pagination
                  className="portal-pagination"
                  current={page}
                  pageSize={12}
                  total={result.data.total}
                  showSizeChanger={false}
                  onChange={(value) => {
                    const next = new URLSearchParams(params);
                    if (value === 1) next.delete("page");
                    else next.set("page", String(value));
                    setParams(next);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                />
              )}
            </>
          )}
        </PortalState>
      </main>
    </SiteFrame>
  );
}
