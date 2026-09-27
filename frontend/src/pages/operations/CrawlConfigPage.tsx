import { useState } from "react";
import { App, Button, Form, Select, Space, Switch, Tabs, Tag } from "antd";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { FormModal } from "../../components/FormModal";
import { DetailsModal } from "../../components/DetailsModal";
import {
  CrawlBasicFields,
  CrawlImageFields,
  CrawlPaginationFields,
  CrawlArticleFields,
} from "../../components/CrawlRuleFields";
import { CrawlExecutionRecords } from "../../components/CrawlExecutionRecords";
import { formatTime } from "../../components/shared";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { usePageState } from "../../lib/workspace";
import {
  crawlStates,
  defaultCrawlRules,
  type CrawlRules,
  type CrawlTask,
} from "../../types/crawler";

interface Edit {
  name: string;
  rules: CrawlRules;
}
interface Preview {
  article?: {
    title: string;
    body: string;
    author: string;
    publishedAt: string;
    truncated: boolean;
  };
  title: string;
  images: string[];
  details: string[];
  pages: string[];
}
const taskStates = [
  "DRAFT",
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "PARTIAL",
  "LIMITED",
];
/** 采集配置独立管理规则与执行过程，不挂载数据卡片；规则解析和执行仍由真实 Java 服务负责。 */
export function CrawlConfigPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [status, setStatus] = usePageState<string | undefined>(
    "crawler.status",
    undefined,
  );
  const [polling, setPolling] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CrawlTask | null>(null);
  const [tab, setTab] = useState("basic");
  const [selected, setSelected] = useState<number>();
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [form] = Form.useForm<Edit>();
  const enter = Form.useWatch(["rules", "enterDetails"], form);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["crawler"] });
    void client.invalidateQueries({ queryKey: ["crawler-task"] });
    void client.invalidateQueries({ queryKey: ["crawler-articles"] });
  };
  const edit = (row: CrawlTask | null, copy = false) => {
    setEditing(copy ? null : row);
    setTab("basic");
    form.resetFields();
    form.setFieldsValue({
      name: row ? `${row.name}${copy ? "（副本）" : ""}`.slice(0, 100) : "",
      rules: row
        ? {
            ...structuredClone(row.rules),
            article: row.rules.article ?? defaultCrawlRules().article,
          }
        : defaultCrawlRules(),
    });
    setOpen(true);
  };
  const run = async (row: CrawlTask, action: string) => {
    // 进度会改变乐观锁版本，操作前读取最新快照；服务器仍原子校验状态和版本，不能越过规则编辑锁。
    const current = await api<CrawlTask>(`/crawler/tasks/${row.id}`);
    await api(`/crawler/tasks/${row.id}/${action}`, {
      method: "POST",
      body: jsonBody({ version: current.version }),
    });
    message.success(action === "stop" ? "任务已停止" : "任务已加入采集队列");
    refresh();
  };
  return (
    <>
      <ResourcePage<CrawlTask>
        resource="crawler"
        endpoint="/crawler/tasks"
        title="采集配置"
        singular="配置"
        createAllowed={false}
        extraToolbar={
          <>
            <Space>
              <span>自动刷新</span>
              <Switch
                aria-label="自动刷新执行进度"
                checked={polling}
                onChange={setPolling}
                size="small"
              />
            </Space>
            {can("crawler:create") && (
              <Button
                type="primary"
                icon={<Plus size={16} />}
                onClick={() => edit(null)}
              >
                新增配置
              </Button>
            )}
          </>
        }
        canEdit={() => false}
        canDelete={(row) => !["QUEUED", "RUNNING"].includes(row.status)}
        fields={() => null}
        actionsWidth={200}
        queryParams={{ status }}
        hasExtraFilters={status !== undefined}
        onResetFilters={() => setStatus(undefined)}
        refetchInterval={polling ? 5000 : false}
        savedFilters={{
          keys: ["status"],
          apply: (values) =>
            setStatus(
              typeof values.status === "string" &&
                taskStates.includes(values.status)
                ? values.status
                : undefined,
            ),
        }}
        extraFilters={
          <Select
            aria-label="执行状态"
            value={status}
            onChange={setStatus}
            allowClear
            placeholder="全部状态"
            options={taskStates.map((value) => ({
              value,
              label: crawlStates[value],
            }))}
          />
        }
        deleteDescription="删除此配置，已采集的文章和图片继续保留在采集数据中。"
        columns={[
          {
            title: "配置名称",
            key: "name",
            width: 280,
            render: (_, row) => (
              <div className="truncate-cell">
                <button
                  className="table-title-link"
                  onClick={() => setSelected(row.id)}
                >
                  {row.name}
                </button>
                <small className="block-muted" title={row.rules.entryUrl}>
                  {row.rules.entryUrl}
                </small>
              </div>
            ),
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 105,
            render: (value) => (
              <Tag
                color={
                  value === "RUNNING"
                    ? "processing"
                    : value === "COMPLETED"
                      ? "success"
                      : value === "PARTIAL"
                        ? "warning"
                        : "default"
                }
              >
                {crawlStates[value]}
              </Tag>
            ),
          },
          {
            title: "页面 / 图片",
            key: "progress",
            width: 120,
            render: (_, row) => `${row.pageCount} 页 / ${row.imageCount} 张`,
          },
          { title: "失败", dataIndex: "failedCount", width: 80 },
          { title: "创建人", dataIndex: "ownerName", width: 100 },
          {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 165,
            render: formatTime,
          },
        ]}
        rowActions={(row) => [
          {
            key: "results",
            label: "执行记录",
            onClick: () => setSelected(row.id),
          },
          {
            key: "start",
            label: row.status === "PAUSED" ? "继续" : "开始采集",
            hidden:
              !can("crawler:run") || !["DRAFT", "PAUSED"].includes(row.status),
            disabled: !can("files:create"),
            disabledReason: !can("files:create")
              ? "需要文件上传权限"
              : undefined,
            onClick: () => run(row, "start"),
          },
          {
            key: "stop",
            label: "停止",
            hidden:
              !can("crawler:stop") ||
              !["QUEUED", "RUNNING"].includes(row.status),
            onClick: () => run(row, "stop"),
          },
          {
            key: "retry",
            label: "重试失败项",
            hidden:
              !can("crawler:run") ||
              !can("files:create") ||
              !["PARTIAL", "PAUSED", "COMPLETED"].includes(row.status) ||
              !row.failedCount,
            onClick: () => run(row, "retry"),
          },
          {
            key: "edit",
            label: "编辑",
            hidden: !can("crawler:update") || row.status !== "DRAFT",
            onClick: () => edit(row),
          },
          {
            key: "copy",
            label: "复制配置",
            hidden: !can("crawler:create"),
            onClick: () => edit(row, true),
          },
        ]}
      />
      <FormModal
        title={editing ? "编辑采集配置" : "新增采集配置"}
        open={open}
        form={form}
        width={820}
        onCancel={() => setOpen(false)}
        onInvalid={(field) =>
          setTab(
            field[1] === "article"
              ? "article"
              : field[1] === "list"
                ? "list"
                : field[1] === "detail"
                  ? "detail"
                  : [
                        "imageSelector",
                        "imageAttributes",
                        "imageHosts",
                        "maxDetails",
                        "maxImages",
                        "intervalMs",
                      ].includes(String(field[1]))
                    ? "images"
                    : "basic",
          )
        }
        onSubmit={async (values) => {
          // 条件字段未挂载时 Ant 的提交值不包含它们；从完整 store 取规则，保留页码默认值和另一种格式配置。
          await api(`/crawler/tasks${editing ? `/${editing.id}` : ""}`, {
            method: editing ? "PUT" : "POST",
            body: jsonBody({
              name: values.name,
              rules: form.getFieldValue("rules"),
              version: editing?.version,
            }),
          });
          setOpen(false);
          refresh();
          message.success("采集配置已保存");
        }}
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "basic",
              label: "基本设置",
              forceRender: true,
              children: <CrawlBasicFields form={form} />,
            },
            {
              key: "list",
              label: "列表分页",
              forceRender: true,
              children: <CrawlPaginationFields level="list" form={form} />,
            },
            {
              key: "detail",
              label: "详情分页",
              forceRender: true,
              disabled: !enter,
              children: <CrawlPaginationFields level="detail" form={form} />,
            },
            {
              key: "article",
              label: "文章内容",
              forceRender: true,
              children: <CrawlArticleFields form={form} />,
            },
            {
              key: "images",
              label: "图片与限额",
              forceRender: true,
              children: <CrawlImageFields />,
            },
          ]}
        />
        {can("crawler:run") && (
          <Button
            loading={testing}
            onClick={async () => {
              try {
                await form.validateFields();
                setTesting(true);
                setPreview(
                  await api<Preview>("/crawler/tasks/preview", {
                    method: "POST",
                    body: jsonBody(form.getFieldValue("rules")),
                    signal: AbortSignal.timeout(30000),
                  }),
                );
              } catch (error) {
                if (error instanceof Error) message.error(error.message);
              } finally {
                setTesting(false);
              }
            }}
          >
            测试入口页规则
          </Button>
        )}
      </FormModal>
      {selected !== undefined && (
        <CrawlExecutionRecords
          key={selected}
          id={selected}
          close={() => setSelected(undefined)}
        />
      )}
      <DetailsModal
        title="入口页解析结果"
        open={!!preview}
        onClose={() => setPreview(undefined)}
        width={800}
        zIndex={1200}
      >
        {preview && (
          <div className="crawler-rule-preview">
            <p>{preview.title || "未读取到网页标题"}</p>
            {preview.article && (
              <section>
                <b>{preview.article.title || "未匹配到文章标题"}</b>
                <p className="muted">
                  {[preview.article.author, preview.article.publishedAt]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="crawler-text-preview">
                  {preview.article.body ||
                    "未匹配到正文，请检查正文选择器或来源页面。"}
                </p>
                {preview.article.truncated && (
                  <p className="muted">正文超过单页长度上限，已截断。</p>
                )}
              </section>
            )}
            {(
              [
                ["图片", preview.images],
                ["详情链接", preview.details],
                ["分页链接", preview.pages],
              ] as const
            ).map(([label, urls]) => (
              <section key={label}>
                <b>{label}（最多显示 10 条）</b>
                {urls.length ? (
                  <ul>
                    {urls.map((url) => (
                      <li key={url}>{url}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">未匹配到结果</p>
                )}
              </section>
            ))}
          </div>
        )}
      </DetailsModal>
    </>
  );
}
