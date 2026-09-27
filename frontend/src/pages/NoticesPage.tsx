import { DataTable } from "../components/DataTable";
import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  type UploadFile,
} from "antd";
import {
  Eye,
  History,
  Plus,
  Pencil,
  Send,
  Undo2,
  ClipboardCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../components/ResourcePage";
import { FormModal } from "../components/FormModal";
import { DetailsModal } from "../components/DetailsModal";
import { QueryState, formatTime } from "../components/shared";
import { CategorySelect, TagSelect } from "../components/LookupSelect";
import { RichTextEditor } from "../components/RichTextEditor";
import { RichTextView } from "../components/RichTextView";
import {
  AttachmentUpload,
  attachmentIds,
} from "../components/AttachmentUpload";
import { AttachmentList } from "../components/AttachmentList";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { ApprovalSubmitModal } from "../components/ApprovalSubmitModal";
import { ApprovalDetailModal } from "../components/ApprovalDetailModal";
import { api, jsonBody } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePageState } from "../lib/workspace";
import {
  contentStatuses,
  type ContentRecord,
  type ContentRevision,
  type Publication,
} from "../types/content";
import type { FileRecord } from "../types/operations";
import type { PageResult } from "../types";

interface DraftForm extends Omit<ContentRevision, "attachments" | "cover"> {
  attachments: UploadFile<FileRecord>[];
  coverFiles: UploadFile<FileRecord>[];
  requiresApproval: boolean;
}
const uploadValues = (files: FileRecord[]): UploadFile<FileRecord>[] =>
  files.map((file) => ({
    uid: String(file.id),
    name: file.name,
    status: "done",
    response: file,
  }));

/** 内容列表只编辑新修订，发布是独立操作；通用表单、附件、富文本、异步分类标签直接组合。 */
export function NoticesPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [status, setStatus] = usePageState<string | undefined>(
    "contentStatus",
    undefined,
  );
  const [categoryId, setCategoryId] = usePageState<number | undefined>(
    "contentCategory",
    undefined,
  );
  const [editing, setEditing] = useState<ContentRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<DraftForm>();
  const [publishing, setPublishing] = useState<ContentRecord | null>(null);
  const [publishForm] = Form.useForm<{
    publishAt?: string;
    offlineAt?: string;
  }>();
  const [selected, setSelected] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<ContentRecord | null>(null);
  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [historyTab, setHistoryTab] = useState("preview");
  const detail = useQuery({
    queryKey: ["notices", "detail", selected],
    queryFn: () => api<ContentRecord>(`/content/notices/${selected}`),
    enabled: selected !== null,
  });
  const history = useQuery({
    queryKey: ["notices", "revisions", selected],
    queryFn: () =>
      api<ContentRevision[]>(`/content/notices/${selected}/revisions`),
    enabled: selected !== null,
  });
  const [historyPage, setHistoryPage] = useState(1);
  const publications = useQuery({
    queryKey: ["notices", "publications", selected, historyPage],
    queryFn: () =>
      api<PageResult<Publication>>(
        `/content/notices/${selected}/publications?page=${historyPage}`,
      ),
    enabled: selected !== null,
  });
  const revision =
    history.data?.find((r) => r.revisionId === previewRevision) ?? detail.data;
  const refresh = () => void client.invalidateQueries();
  const edit = async (row: ContentRecord | null) => {
    try {
      const record = row
        ? await api<ContentRecord>(`/content/notices/${row.id}`)
        : null;
      setEditing(record);
      form.resetFields();
      form.setFieldsValue(
        record
          ? {
              ...record,
              attachments: uploadValues(record.attachments),
              coverFiles: uploadValues(record.cover ? [record.cover] : []),
            }
          : {
              visibility: "PUBLIC",
              requiresApproval: false,
              tagIds: [],
              attachments: [],
              coverFiles: [],
              sortOrder: 0,
              pinned: false,
              recommended: false,
            },
      );
      setOpen(true);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const show = (row: ContentRecord, tab = "preview") => {
    setSelected(row.id);
    setPreviewRevision(null);
    setHistoryPage(1);
    setHistoryTab(tab);
  };
  return (
    <>
      <ResourcePage<ContentRecord>
        resource="notices"
        endpoint="/content/notices"
        title="内容中心"
        singular="内容"
        createAllowed={false}
        canEdit={() => false}
        canDelete={(r) =>
          (!r.published && !r.scheduledPublishAt) || can("notices:publish")
        }
        fields={() => null}
        deleteDescription="内容将移入回收站，取消上线排期并立即从前台撤下。"
        actionsWidth={180}
        queryParams={{ status, categoryId }}
        savedFilters={{
          keys: ["status", "categoryId"],
          apply: (values) => {
            setStatus(
              typeof values.status === "string" &&
                contentStatuses.some((item) => item.value === values.status)
                ? values.status
                : undefined,
            );
            setCategoryId(
              typeof values.categoryId === "number" && values.categoryId > 0
                ? values.categoryId
                : undefined,
            );
          },
        }}
        hasExtraFilters={status !== undefined || categoryId !== undefined}
        onResetFilters={() => {
          setStatus(undefined);
          setCategoryId(undefined);
        }}
        extraFilters={
          <>
            <Select
              aria-label="内容状态"
              value={status}
              onChange={setStatus}
              allowClear
              placeholder="全部状态"
              options={contentStatuses}
            />
            <CategorySelect
              aria-label="内容分类筛选"
              value={categoryId}
              onChange={(v) =>
                setCategoryId(typeof v === "number" ? v : undefined)
              }
            />
          </>
        }
        extraToolbar={
          can("notices:create") && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => void edit(null)}
            >
              新增内容
            </Button>
          )
        }
        columns={[
          {
            title: "标题",
            dataIndex: "title",
            width: 300,
            render: (_, r) => (
              <div className="truncate-cell">
                <button
                  type="button"
                  className="table-title-link"
                  title={r.title}
                  onClick={() => show(r)}
                >
                  {r.title}
                </button>
                <small>
                  修订 {r.revisionNumber}
                  {r.liveRevisionId && r.liveRevisionId !== r.revisionId
                    ? " · 有线上版本"
                    : ""}
                </small>
              </div>
            ),
          },
          { title: "分类", dataIndex: "category", width: 100 },
          {
            title: "当前修订",
            dataIndex: "status",
            width: 104,
            render: (v) => (
              <Tag
                color={
                  v === "PUBLISHED"
                    ? "green"
                    : v === "PENDING"
                      ? "orange"
                      : "default"
                }
              >
                {contentStatuses.find((s) => s.value === v)?.label ?? v}
              </Tag>
            ),
          },
          {
            title: "前台展示",
            dataIndex: "published",
            width: 100,
            render: (_, r) =>
              r.publiclyVisible ? (
                <Tag color="green">展示中</Tag>
              ) : r.published ? (
                "仅后台"
              ) : (
                "未展示"
              ),
          },
          { title: "作者", dataIndex: "authorName", width: 110 },
          {
            title: "浏览次数",
            dataIndex: "viewCount",
            width: 90,
            align: "right",
          },
          {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 170,
            render: formatTime,
          },
        ]}
        rowActions={(row) => [
          {
            key: "preview",
            label: "预览",
            icon: <Eye size={15} />,
            onClick: () => show(row),
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil size={15} />,
            hidden: !can("notices:update"),
            onClick: () => edit(row),
          },
          {
            key: "publish",
            label: "发布或排期",
            icon: <Send size={15} />,
            hidden: !can("notices:publish"),
            disabled:
              row.effectiveApprovalRequired &&
              row.approvalStatus !== "APPROVED",
            disabledReason:
              row.effectiveApprovalRequired && row.approvalStatus !== "APPROVED"
                ? "当前修订须先通过审核"
                : undefined,
            onClick: () => {
              publishForm.resetFields();
              setPublishing(row);
            },
          },
          {
            key: "submit",
            label: "提交审核",
            icon: <ClipboardCheck size={15} />,
            hidden:
              !can("requests:create") ||
              !can("notices:update") ||
              ["PENDING", "APPROVED"].includes(row.approvalStatus),
            onClick: () => setReviewing(row),
          },
          {
            key: "review",
            label: "查看审核",
            icon: <ClipboardCheck size={15} />,
            hidden: !row.approvalRequestId || !can("requests:view"),
            onClick: () => setApprovalId(row.approvalRequestId),
          },
          {
            key: "history",
            label: "修订与发布记录",
            icon: <History size={15} />,
            onClick: () => show(row, "versions"),
          },
          {
            key: "offline",
            label: "下线",
            icon: <Undo2 size={15} />,
            danger: true,
            hidden:
              !(row.published || row.scheduledPublishAt) ||
              !can("notices:publish"),
            confirm: {
              title: "下线这篇内容？",
              description:
                "前台列表、详情、封面与附件会同时停止访问，并取消未执行的上线排期。",
            },
            onClick: async () => {
              await api(`/content/notices/${row.id}/offline`, {
                method: "POST",
                body: jsonBody({ version: row.version }),
              });
              refresh();
              message.success("内容已下线");
            },
          },
        ]}
      />
      <ApprovalSubmitModal
        open={reviewing !== null}
        content={reviewing}
        onClose={() => setReviewing(null)}
        onSuccess={(record) => setApprovalId(record.id)}
      />
      <ApprovalDetailModal
        id={approvalId}
        onClose={() => setApprovalId(null)}
      />
      <FormModal
        title={editing ? "编辑内容 · 新修订" : "新增内容"}
        open={open}
        form={form}
        width={1000}
        okText="保存草稿"
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          await api(`/content/notices${editing ? `/${editing.id}` : ""}`, {
            method: editing ? "PUT" : "POST",
            body: jsonBody({
              ...values,
              contentFormat: "HTML",
              attachmentIds: attachmentIds(values.attachments),
              coverId: attachmentIds(values.coverFiles)[0] ?? null,
              attachments: undefined,
              coverFiles: undefined,
              published: undefined,
              version: editing?.version,
            }),
          });
          setOpen(false);
          refresh();
          message.success("新修订已保存，线上版本保持原样");
        }}
      >
        {open && (
          <>
            {editing?.approvalStatus === "PENDING" && (
              <Alert
                className="form-message"
                type="warning"
                title="此修订正在审核；保存会产生新修订，新修订需要重新送审。"
              />
            )}
            {editing?.scheduledPublishAt && (
              <Alert
                className="form-message"
                type="warning"
                title="保存新修订会取消尚未执行的上线排期，请保存后重新安排。"
              />
            )}
            <Form.Item
              name="title"
              label="内容标题"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={160} />
            </Form.Item>
            <div className="form-two-columns">
              <Form.Item
                name="categoryId"
                label="分类"
                rules={[{ required: true }]}
              >
                <CategorySelect
                  initialOptions={
                    editing
                      ? [{ value: editing.categoryId, label: editing.category }]
                      : []
                  }
                />
              </Form.Item>
              <Form.Item
                name="tagIds"
                label="标签"
                rules={[{ type: "array", max: 10 }]}
              >
                <TagSelect initialOptions={editing?.tagOptions ?? []} />
              </Form.Item>
            </div>
            <Form.Item name="summary" label="摘要">
              <Input.TextArea rows={2} maxLength={500} showCount />
            </Form.Item>
            <Form.Item
              name="coverFiles"
              label="封面"
              extra="支持 PNG、JPEG、WebP；不上传时前台使用无图列表。"
            >
              <AttachmentUpload
                picture
                accept=".png,.jpg,.jpeg,.webp"
                maxCount={1}
                disabled={!can("files:create")}
              />
            </Form.Item>
            <Form.Item
              name="content"
              label="正文"
              rules={[
                { required: true, message: "请输入正文" },
                { max: 50000, message: "正文连同格式不得超过 50000 字符" },
              ]}
            >
              <RichTextEditor />
            </Form.Item>
            <Form.Item name="attachments" label="附件">
              <AttachmentUpload disabled={!can("files:create")} />
            </Form.Item>
            <div className="form-two-columns">
              <Form.Item
                name="visibility"
                label="公开范围"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: "PUBLIC", label: "公开门户" },
                    { value: "INTERNAL", label: "仅后台可见" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="sortOrder"
                label="展示排序"
                extra="数字越大越靠前"
              >
                <InputNumber min={0} max={9999} />
              </Form.Item>
            </div>
            <div className="form-two-columns">
              <Form.Item name="pinned" label="置顶" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="recommended"
                label="首页推荐"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </div>
            <Form.Item
              name="requiresApproval"
              label="发布前必须审核"
              valuePropName="checked"
              extra="全局强制审核开启时，此处关闭也不能跳过审核。"
            >
              <Switch
                disabled={
                  !!editing?.requiresApproval && !can("notices:publish")
                }
              />
            </Form.Item>
            <Form.Item name="seoTitle" label="SEO 标题">
              <Input maxLength={160} placeholder="留空使用内容标题" />
            </Form.Item>
            <Form.Item name="seoKeywords" label="SEO 关键词">
              <Input maxLength={250} />
            </Form.Item>
            <Form.Item name="seoDescription" label="SEO 描述">
              <Input.TextArea
                rows={2}
                maxLength={500}
                placeholder="留空使用摘要"
              />
            </Form.Item>
          </>
        )}
      </FormModal>
      <FormModal
        title="发布内容"
        open={publishing !== null}
        form={publishForm}
        onCancel={() => setPublishing(null)}
        okText="确认发布"
        onSubmit={async (values) => {
          await api(`/content/notices/${publishing!.id}/publish`, {
            method: "POST",
            body: jsonBody({
              version: publishing!.version,
              revisionId: publishing!.revisionId,
              publishAt: values.publishAt || null,
              offlineAt: values.offlineAt || null,
            }),
          });
          setPublishing(null);
          refresh();
          message.success(values.publishAt ? "上线排期已保存" : "内容已发布");
        }}
      >
        <p>
          {publishing?.title} · 修订 {publishing?.revisionNumber}
        </p>
        <Form.Item
          name="publishAt"
          label="上线时间"
          extra="留空立即上线；填写时间按 Asia/Shanghai（北京时间）执行。"
        >
          <Input type="datetime-local" />
        </Form.Item>
        <Form.Item
          name="offlineAt"
          label="下线时间"
          extra="留空表示不自动下线。"
        >
          <Input type="datetime-local" />
        </Form.Item>
      </FormModal>
      <DetailsModal
        title="内容详情"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={1000}
      >
        <QueryState
          loading={detail.isLoading}
          error={detail.error}
          retry={() => void detail.refetch()}
        >
          {detail.data && (
            <>
              {detail.data.scheduleError && (
                <Alert type="warning" title={detail.data.scheduleError} />
              )}
              <Tabs
                activeKey={historyTab}
                onChange={setHistoryTab}
                items={[
                  {
                    key: "preview",
                    label: "内容预览",
                    children: revision && (
                      <>
                        <Space wrap>
                          <Select
                            aria-label="预览修订"
                            value={revision.revisionId}
                            onChange={setPreviewRevision}
                            options={history.data?.map((r) => ({
                              value: r.revisionId,
                              label: `修订 ${r.revisionNumber}${r.revisionId === detail.data.liveRevisionId ? " · 线上版本" : ""}`,
                            }))}
                          />
                          <Tag>
                            {revision.visibility === "PUBLIC"
                              ? "公开门户"
                              : "仅后台可见"}
                          </Tag>
                        </Space>
                        <h2>{revision.title}</h2>
                        <Descriptions
                          column={2}
                          items={[
                            {
                              key: "category",
                              label: "分类",
                              children: revision.category,
                            },
                            {
                              key: "tags",
                              label: "标签",
                              children: revision.tags.join("、") || "—",
                            },
                            {
                              key: "author",
                              label: "作者",
                              children: detail.data.authorName,
                            },
                            {
                              key: "views",
                              label: "浏览次数",
                              children: detail.data.viewCount,
                            },
                          ]}
                        />
                        <p className="muted">{revision.summary}</p>
                        {revision.coverId && (
                          <AuthenticatedImage
                            endpoint={`/content/notices/${selected}/revisions/${revision.revisionId}/files/${revision.coverId}?image=true`}
                            alt={revision.title}
                          />
                        )}
                        <RichTextView content={revision.content} />
                        <AttachmentList
                          files={revision.attachments}
                          endpoint={(file) =>
                            `/content/notices/${selected}/revisions/${revision.revisionId}/files/${file.id}`
                          }
                        />
                      </>
                    ),
                  },
                  {
                    key: "versions",
                    label: "修订记录",
                    children: (
                      <QueryState
                        loading={history.isLoading}
                        error={history.error}
                        retry={() => void history.refetch()}
                      >
                        <DataTable
                          rowKey="revisionId"
                          size="small"
                          dataSource={history.data}
                          pagination={{ pageSize: 10 }}
                          columns={[
                            { title: "修订", dataIndex: "revisionNumber" },
                            { title: "标题", dataIndex: "title" },
                            { title: "编辑人", dataIndex: "editorName" },
                            {
                              title: "保存时间",
                              dataIndex: "revisedAt",
                              render: formatTime,
                            },
                            {
                              title: "操作",
                              render: (_, r) => (
                                <Button
                                  type="link"
                                  onClick={() => {
                                    setPreviewRevision(r.revisionId);
                                    setHistoryTab("preview");
                                  }}
                                >
                                  预览此版本
                                </Button>
                              ),
                            },
                          ]}
                        />
                      </QueryState>
                    ),
                  },
                  {
                    key: "publications",
                    label: "发布记录",
                    children: (
                      <QueryState
                        loading={publications.isLoading}
                        error={publications.error}
                        retry={() => void publications.refetch()}
                      >
                        <DataTable
                          rowKey="id"
                          size="small"
                          dataSource={publications.data?.items}
                          pagination={{
                            current: historyPage,
                            pageSize: 10,
                            total: publications.data?.total,
                            onChange: setHistoryPage,
                            showSizeChanger: false,
                          }}
                          columns={[
                            { title: "操作人", dataIndex: "operatorName" },
                            {
                              title: "上线时间",
                              dataIndex: "publishedAt",
                              render: formatTime,
                            },
                            {
                              title: "下线时间",
                              dataIndex: "offlineAt",
                              render: (v) => (v ? formatTime(v) : "展示中"),
                            },
                            { title: "说明", dataIndex: "reason" },
                          ]}
                        />
                      </QueryState>
                    ),
                  },
                ]}
              />
            </>
          )}
        </QueryState>
      </DetailsModal>
    </>
  );
}

/** 回收站沿用内容数据范围；恢复只回草稿，永久删除有独立权限，默认不替用户删除附件文件。 */
export function RecyclePage() {
  const { can } = useAuth();
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const run = async (row: ContentRecord, purge: boolean) => {
    try {
      await api(`/content/notices/${row.id}/${purge ? "purge" : "restore"}`, {
        method: purge ? "DELETE" : "POST",
        body: purge ? undefined : jsonBody({ version: row.version }),
      });
      void client.invalidateQueries();
      message.success(purge ? "内容已永久删除" : "内容已恢复为草稿");
    } catch (error) {
      message.error((error as Error).message);
      throw error;
    }
  };
  return (
    <ResourcePage<ContentRecord>
      resource="notices"
      endpoint="/content/notices/recycle"
      title="内容回收站"
      singular="内容"
      readOnly
      fields={() => null}
      columns={[
        { title: "标题", dataIndex: "title", width: 300 },
        { title: "分类", dataIndex: "category", width: 120 },
        { title: "作者", dataIndex: "authorName", width: 120 },
        {
          title: "删除时间",
          dataIndex: "deletedAt",
          width: 170,
          render: formatTime,
        },
      ]}
      extraActions={(row) => (
        <>
          {can("notices:restore") && (
            <Button
              type="link"
              onClick={() => void run(row, false).catch(() => {})}
            >
              恢复
            </Button>
          )}
          {can("notices:purge") && (
            <Button
              type="link"
              danger
              onClick={() =>
                modal.confirm({
                  title: "永久删除这篇内容？",
                  content: "全部修订及发布历史将删除，无法恢复。附件文件保留。",
                  okText: "永久删除",
                  okButtonProps: { danger: true },
                  centered: true,
                  onOk: () => run(row, true),
                })
              }
            >
              删除
            </Button>
          )}
        </>
      )}
    />
  );
}
