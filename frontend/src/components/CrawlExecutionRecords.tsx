import { useEffect, useState } from "react";
import { Button, Descriptions, Pagination, Select, Space, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { DetailsModal } from "./DetailsModal";
import { DataTable } from "./DataTable";
import { useModalTablePagination } from "./useModalTablePagination";
import { QueryState } from "./shared";
import { api, queryString } from "../lib/api";
import type { PageResult } from "../types";
import { crawlStates, type CrawlItem, type CrawlTask } from "../types/crawler";

/** 配置的执行记录只用于排查进度与失败原因；文章与图片浏览由独立数据页负责。 */
export function CrawlExecutionRecords({
  id,
  close,
}: {
  id: number;
  close: () => void;
}) {
  const { ref, page, pageSize, setPage } = useModalTablePagination();
  const [kind, setKind] = useState<string | undefined>("IMAGE");
  const [status, setStatus] = useState<string>();
  const task = useQuery({
    queryKey: ["crawler-task", id],
    queryFn: () => api<CrawlTask>(`/crawler/tasks/${id}`),
    refetchInterval: 5000,
  });
  const results = useQuery({
    queryKey: ["crawler-results", id, page, pageSize, kind, status],
    queryFn: ({ signal }) =>
      api<PageResult<CrawlItem>>(
        `/crawler/tasks/${id}/items?${queryString({ page, size: pageSize, kind, status })}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
  // 筛选或执行进度更新后总数可能变少，避免停在已经不存在的页码。
  useEffect(() => {
    if (results.data) {
      const lastPage = Math.max(1, Math.ceil(results.data.total / pageSize));
      if (page > lastPage) setPage(lastPage);
    }
  }, [results.data, page, pageSize, setPage]);
  return (
    <>
      <DetailsModal title="执行记录" open onClose={close} width={1120}>
        <div className="crawl-execution-summary">
          <QueryState
            loading={task.isLoading}
            error={task.error}
            retry={() => void task.refetch()}
          >
            {task.data && (
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2, md: 4 }}
                items={[
                  {
                    key: "name",
                    label: "配置名称",
                    children: (
                      <span
                        className="crawl-record-line"
                        title={task.data.name}
                      >
                        {task.data.name}
                      </span>
                    ),
                    span: "filled",
                  },
                  {
                    key: "status",
                    label: "状态",
                    children: crawlStates[task.data.status],
                  },
                  {
                    key: "pages",
                    label: "已解析页面",
                    children: task.data.pageCount,
                  },
                  {
                    key: "images",
                    label: "已保存图片",
                    children: task.data.imageCount,
                  },
                  {
                    key: "bytes",
                    label: "累计大小",
                    children: `${(task.data.totalBytes / 1048576).toFixed(1)} MB`,
                  },
                  ...(task.data.lastError
                    ? [
                        {
                          key: "error",
                          label: "最近提示",
                          span: "filled" as const,
                          children: (
                            <span
                              className="crawl-record-line"
                              title={task.data.lastError}
                            >
                              {task.data.lastError}
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </QueryState>
        </div>
        <Space wrap className="crawl-execution-filters">
          <Select
            aria-label="记录类型"
            style={{ width: 140 }}
            value={kind}
            allowClear
            placeholder="全部类型"
            options={[
              { value: "IMAGE", label: "图片" },
              { value: "LIST", label: "列表页" },
              { value: "DETAIL", label: "详情页" },
            ]}
            onChange={(value) => {
              setKind(value);
              setPage(1);
            }}
          />
          <Select
            aria-label="采集结果"
            style={{ width: 140 }}
            value={status}
            allowClear
            placeholder="全部结果"
            options={[
              "QUEUED",
              "FETCHING",
              "SUCCESS",
              "FAILED",
              "DUPLICATE",
              "SKIPPED",
            ].map((value) => ({ value, label: crawlStates[value] }))}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <Button
            onClick={() => {
              void results.refetch();
              void task.refetch();
            }}
          >
            刷新
          </Button>
        </Space>
        <div ref={ref} className="crawl-execution-results">
          <QueryState
            loading={false}
            error={results.error}
            retry={() => void results.refetch()}
          >
            <DataTable<CrawlItem>
              rowKey="id"
              size="small"
              className="crawl-execution-table"
              loading={results.isLoading}
              dataSource={results.data?.items ?? []}
              pagination={false}
              sequence={(_, index) => (page - 1) * pageSize + index + 1}
              columns={[
                {
                  title: "地址 / 来源页",
                  key: "url",
                  width: 380,
                  render: (_, row) => (
                    <div className="crawl-record-address">
                      <span className="crawl-record-line" title={row.url}>
                        {row.title || row.url}
                      </span>
                      <small
                        className="crawl-record-line block-muted"
                        title={row.sourceUrl || row.url}
                      >
                        {row.sourceUrl || row.url}
                      </small>
                    </div>
                  ),
                },
                {
                  title: "结果",
                  dataIndex: "status",
                  width: 90,
                  render: (value) => (
                    <Tag
                      color={
                        value === "SUCCESS"
                          ? "success"
                          : value === "FAILED"
                            ? "error"
                            : "default"
                      }
                    >
                      {crawlStates[value]}
                    </Tag>
                  ),
                },
                {
                  title: "大小",
                  dataIndex: "bytes",
                  width: 90,
                  render: (value) =>
                    value ? `${(value / 1024).toFixed(1)} KB` : "—",
                },
                {
                  title: "说明",
                  dataIndex: "error",
                  width: 210,
                  render: (value, row) => {
                    const detail =
                      value ||
                      (row.status === "DUPLICATE"
                        ? "与已保存图片相同"
                        : `尝试 ${row.attempts} 次`);
                    return (
                      <span className="crawl-record-note" title={detail}>
                        {detail}
                      </span>
                    );
                  },
                },
              ]}
            />
          </QueryState>
          {/* 分页始终占据固定区域，加载时不消失，避免容量计算因分页反复出现而跳动。 */}
          <div aria-label="执行记录分页">
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={results.data?.total ?? 0}
              showSizeChanger={false}
              showTotal={(total) => `共 ${total} 条 · 每页 ${pageSize} 条`}
              onChange={setPage}
            />
          </div>
        </div>
      </DetailsModal>
    </>
  );
}
