import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  App,
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Pagination,
  Tabs,
} from "antd";
import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { downloadCrawlImage } from "../lib/crawler-images";
import { CollectedImage, CrawlImageViewer } from "./CrawlImages";
import { QueryState } from "./shared";
import { useGridPagination } from "./useGridPagination";
import type { PageResult } from "../types";
import {
  type CrawlArticleCard,
  type CrawlArticleDetail,
} from "../types/crawler";

/** 任务与卡片轮询可能错开；任务结束时补读一次，避免最后一张封面停留在等待状态。 */
function useFinalResult(active: boolean, refetch: () => Promise<unknown>) {
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current && !active) void refetch();
    previous.current = active;
  }, [active, refetch]);
}

/** 缩略图只渲染当前页；放大时使用整篇图片列表与绝对序号，跨页预览不会从第一张重新开始。 */
function ArticleGallery({
  detail,
  visible,
  preview,
}: {
  detail: CrawlArticleDetail;
  visible: boolean;
  preview: (index: number) => void;
}) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState<number>();
  const grid = useGridPagination("container");
  const page = Math.min(
    grid.page,
    Math.max(1, Math.ceil(detail.images.length / grid.pageSize)),
  );
  const start = (page - 1) * grid.pageSize;
  return (
    <div
      className="crawl-gallery-section"
      style={visible ? undefined : { display: "none" }}
    >
      <div className="crawl-gallery-viewport" ref={grid.ref}>
        {detail.images.length ? (
          <div
            className="crawl-article-gallery"
            style={{
              gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
            }}
          >
            {detail.images
              .slice(start, start + grid.pageSize)
              .map((image, offset) => {
                const index = start + offset;
                return (
                  <figure key={image.id}>
                    <button
                      type="button"
                      className="crawl-thumbnail"
                      aria-label={`放大查看第 ${index + 1} 张图片`}
                      disabled={!can("crawler:download")}
                      onClick={() => preview(index)}
                    >
                      <CollectedImage
                        task={detail.article.taskId}
                        item={image.id}
                        alt={`配图 ${index + 1}`}
                      />
                    </button>
                    <figcaption>
                      <span>{index + 1}</span>
                      {can("crawler:download") && (
                        <Button
                          type="text"
                          size="small"
                          loading={downloading === image.id}
                          onClick={async () => {
                            setDownloading(image.id);
                            try {
                              await downloadCrawlImage(
                                detail.article.taskId,
                                image.id,
                              );
                            } catch (error) {
                              message.error((error as Error).message);
                            } finally {
                              setDownloading(undefined);
                            }
                          }}
                        >
                          下载
                        </Button>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              detail.article.pendingImages ? "图片正在采集中" : "暂无已采集图片"
            }
          />
        )}
      </div>
      <div
        className="crawl-pagination"
        ref={grid.pagerRef}
        aria-label="图片分页"
      >
        <Pagination
          current={page}
          pageSize={grid.pageSize}
          total={detail.images.length}
          onChange={grid.setPage}
          showSizeChanger={false}
          showLessItems
          simple={grid.compact}
          showTotal={(total) => `共 ${total} 张`}
        />
      </div>
    </div>
  );
}

function ArticleDetail({
  article,
  close,
  active,
}: {
  article: CrawlArticleCard;
  close: () => void;
  active: boolean;
}) {
  const [preview, setPreview] = useState<number>();
  const [tab, setTab] = useState("images");
  const query = useQuery({
    queryKey: ["crawler-article", article.taskId, article.id],
    queryFn: () =>
      api<CrawlArticleDetail>(
        `/crawler/tasks/${article.taskId}/articles/${article.id}`,
      ),
    refetchInterval: active ? 5000 : false,
  });
  const detail = query.data;
  useFinalResult(active, query.refetch);
  return (
    <Drawer
      title="图文详情"
      open
      placement="right"
      size="min(920px, 100vw)"
      onClose={close}
      zIndex={1200}
      keyboard={preview === undefined}
      className="crawl-detail-drawer"
      destroyOnHidden
    >
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      >
        {detail && (
          <article className="crawl-article-detail">
            <h2 title={detail.article.title}>{detail.article.title}</h2>
            <div className="crawl-article-meta">
              {detail.article.author && <span>{detail.article.author}</span>}
              {detail.article.publishedAt && (
                <span>{detail.article.publishedAt}</span>
              )}
              <span>已采集 {detail.article.imageCount} 张</span>
              {!!detail.article.pendingImages && (
                <span>等待 {detail.article.pendingImages} 张</span>
              )}
              {!!detail.article.failedImages && (
                <span>失败 {detail.article.failedImages} 张</span>
              )}
              <span>{detail.article.pageCount} 个详情页</span>
            </div>
            <a
              className="crawl-article-source"
              href={detail.article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {detail.article.sourceUrl}
            </a>
            {detail.article.taskStatus === "LIMITED" && (
              <Alert
                type="warning"
                showIcon
                title="采集达到上限，当前图片可能不完整。"
              />
            )}
            <Tabs
              activeKey={tab}
              onChange={setTab}
              className="crawl-detail-tabs"
              items={[
                { key: "images", label: `图片 (${detail.images.length})` },
                ...(detail.pages.some((page) => page.body)
                  ? [{ key: "body", label: "文章正文" }]
                  : []),
              ]}
            />
            <ArticleGallery
              detail={detail}
              visible={tab === "images"}
              preview={setPreview}
            />
            {tab === "body" && (
              <div
                className="crawl-article-text"
                tabIndex={0}
                aria-label="文章正文内容"
              >
                {detail.truncated && (
                  <Alert
                    type="warning"
                    showIcon
                    title="正文已达到长度上限，请通过来源地址查看全文。"
                  />
                )}
                <div className="crawl-article-body">
                  {detail.pages.map(
                    (page) => page.body && <div key={page.id}>{page.body}</div>,
                  )}
                </div>
              </div>
            )}
          </article>
        )}
      </QueryState>
      {preview !== undefined && detail && (
        <CrawlImageViewer
          task={article.taskId}
          pictures={detail.images}
          initial={preview}
          close={() => setPreview(undefined)}
        />
      )}
    </Drawer>
  );
}

/** 默认跨任务展示文章卡片；传入 task 时复用为单任务结果。服务器在分页前检查数据权限。 */
export function CrawlArticleCards({
  task,
  active,
}: {
  task?: number;
  active: boolean;
}) {
  const grid = useGridPagination("page");
  const { page, pageSize, setPage } = grid;
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<CrawlArticleCard>();
  const query = useQuery({
    queryKey: ["crawler-articles", task, page, pageSize, keyword],
    queryFn: () =>
      api<PageResult<CrawlArticleCard>>(
        `/crawler/tasks${task ? `/${task}` : ""}/articles?${queryString({ page, size: pageSize, keyword })}`,
      ),
    refetchInterval: active ? 5000 : false,
  });
  useFinalResult(active, query.refetch);
  // 自动刷新或删除任务后退回有效页，避免最后一页为空时误以为采集结果丢失。
  useEffect(() => {
    if (
      query.data &&
      page > Math.max(1, Math.ceil(query.data.total / pageSize))
    )
      setPage(Math.max(1, Math.ceil(query.data.total / pageSize)));
  }, [query.data, page, pageSize, setPage]);
  return (
    <>
      <div className="crawl-articles-toolbar">
        <Input.Search
          aria-label="搜索采集文章"
          placeholder="搜索文章标题"
          allowClear
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Button
          icon={<RefreshCw size={15} />}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新
        </Button>
      </div>
      <div ref={grid.ref} className="crawl-cards-viewport">
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {query.data?.items.length ? (
            <>
              <div
                className={`crawl-article-grid${grid.rowHeight < 220 ? " is-compact" : ""}`}
                style={
                  {
                    "--crawl-card-height": `${grid.rowHeight}px`,
                    gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
                  } as CSSProperties
                }
              >
                {query.data.items.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className="crawl-article-card"
                    onClick={() => setSelected(article)}
                  >
                    <CollectedImage
                      task={article.taskId}
                      item={article.coverItemId}
                      alt={article.title}
                      cover
                    />
                    <div className="crawl-article-card-content">
                      <h3 title={article.title}>{article.title}</h3>
                      <p>{article.summary || "\u00a0"}</p>
                      <div className="crawl-article-meta">
                        <span>{article.imageCount} 张图片</span>
                        {!!article.pendingImages && (
                          <span>{article.pendingImages} 张待采集</span>
                        )}
                        {!!article.failedImages && (
                          <span>{article.failedImages} 张失败</span>
                        )}
                      </div>
                      <div className="crawl-article-card-source">
                        <span title={new URL(article.sourceUrl).hostname}>
                          {new URL(article.sourceUrl).hostname}
                        </span>
                        <time>{article.collectedAt.slice(0, 10)}</time>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={keyword ? "未找到相关文章" : "暂无采集数据"}
            />
          )}
        </QueryState>
      </div>
      <div
        className="crawl-pagination"
        ref={grid.pagerRef}
        aria-label="文章分页"
      >
        <Pagination
          current={page}
          pageSize={pageSize}
          total={query.data?.total ?? 0}
          onChange={setPage}
          showSizeChanger={false}
          showLessItems
          simple={grid.compact}
          showTotal={(total) => `共 ${total} 篇`}
        />
      </div>
      {selected && (
        <ArticleDetail
          key={selected.id}
          article={selected}
          active={active}
          close={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
