import { DataTable } from "../../components/DataTable";
import { useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Select,
  Tag,
  Descriptions,
  type UploadFile,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Pencil, Send, Undo2, Plus } from "lucide-react";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { usePageState } from "../../lib/workspace";
import { ResourcePage } from "../../components/ResourcePage";
import { FormModal } from "../../components/FormModal";
import { DetailsModal } from "../../components/DetailsModal";
import { QueryState, formatTime } from "../../components/shared";
import { UserSelect, type LookupOption } from "../../components/LookupSelect";
import { RichTextEditor } from "../../components/RichTextEditor";
import { RichTextView } from "../../components/RichTextView";
import {
  AttachmentUpload,
  attachmentIds,
} from "../../components/AttachmentUpload";
import { AttachmentList } from "../../components/AttachmentList";
import {
  notificationTypes,
  notificationStatuses,
  audienceTypes,
  type NotificationRecord,
} from "../../types/notifications";
import type { FileRecord } from "../../types/operations";
import type { PageResult } from "../../types";

interface DraftForm {
  title: string;
  summary: string;
  content: string;
  type: string;
  recipientType: NotificationRecord["recipientType"];
  recipientIds: number[];
  attachments: UploadFile<FileRecord>[];
  expiresAt?: string;
}

/** 接收组只展示服务端确认当前发送人可完整覆盖的组，初值名称由已鉴权详情提供。 */
function RecipientGroups({
  kind,
  initialOptions,
  ...props
}: {
  kind: "departments" | "roles";
  initialOptions: LookupOption[];
  value?: number[];
  onChange?: (value: number[]) => void;
  id?: string;
}) {
  const query = useQuery({
    queryKey: ["notification-options", kind],
    queryFn: () =>
      api<LookupOption[]>(`/operations/notifications/options/${kind}`),
  });
  return (
    <Select
      {...props}
      mode="multiple"
      allowClear
      showSearch={{ optionFilterProp: "label" }}
      loading={query.isLoading}
      options={Array.from(
        new Map(
          [...initialOptions, ...(query.data ?? [])].map((o) => [o.value, o]),
        ).values(),
      )}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
    />
  );
}
/** 通知管理保存草稿与发布分开；发布/撤回使用版本与服务端幂等操作，失败后保留当前表单。 */
export function NotificationsPage() {
  const { can, session } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [status, setStatus] = usePageState<string | undefined>(
    "notificationStatus",
    undefined,
  );
  const [editing, setEditing] = useState<NotificationRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<DraftForm>();
  const recipientType = Form.useWatch("recipientType", form);
  const [selected, setSelected] = useState<number | null>(null);
  const [recipientPage, setRecipientPage] = useState(1);
  const detail = useQuery({
    queryKey: ["notifications", "detail", selected],
    queryFn: () =>
      api<NotificationRecord>(`/operations/notifications/${selected}`),
    enabled: selected !== null,
    refetchInterval: 30000,
  });
  const recipients = useQuery({
    queryKey: ["notifications", "recipients", selected, recipientPage],
    queryFn: () =>
      api<PageResult<{ id: number; name: string; readAt: string }>>(
        `/operations/notifications/${selected}/recipients?page=${recipientPage}`,
      ),
    enabled: selected !== null && detail.data?.status !== "DRAFT",
  });
  const refresh = () => void client.invalidateQueries();
  const own = (row: NotificationRecord) =>
    can("notifications:all") || row.senderId === session?.user.id;
  const edit = async (row: NotificationRecord | null) => {
    try {
      const record = row
        ? await api<NotificationRecord>(`/operations/notifications/${row.id}`)
        : null;
      setEditing(record);
      form.resetFields();
      form.setFieldsValue(
        record
          ? {
              ...record,
              expiresAt: record.expiresAt ?? undefined,
              attachments: record.attachments.map((file) => ({
                uid: String(file.id),
                name: file.name,
                status: "done",
                response: file,
              })),
            }
          : {
              type: "NOTICE",
              recipientType: "USERS",
              recipientIds: [],
              attachments: [],
            },
      );
      setOpen(true);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const action = async (
    row: NotificationRecord,
    verb: "publish" | "withdraw" | "copy",
  ) => {
    const result = await api<NotificationRecord>(
      `/operations/notifications/${row.id}/${verb}`,
      {
        method: "POST",
        body: verb === "copy" ? undefined : jsonBody({ version: row.version }),
      },
    );
    refresh();
    message.success(
      verb === "publish"
        ? "通知已发布"
        : verb === "withdraw"
          ? "通知已撤回"
          : "已复制为草稿",
    );
    if (verb === "copy") void edit(result);
  };
  return (
    <>
      <ResourcePage<NotificationRecord>
        resource="notifications"
        endpoint="/operations/notifications"
        title="通知管理"
        singular="通知"
        createAllowed={false}
        canEdit={() => false}
        canDelete={(row) =>
          ["DRAFT", "WITHDRAWN"].includes(row.status) && own(row)
        }
        fields={() => null}
        actionsWidth={220}
        queryParams={{ status }}
        savedFilters={{
          keys: ["status"],
          apply: (values) =>
            setStatus(
              typeof values.status === "string" &&
                notificationStatuses.some(
                  (item) => item.value === values.status,
                )
                ? values.status
                : undefined,
            ),
        }}
        hasExtraFilters={status !== undefined}
        onResetFilters={() => setStatus(undefined)}
        deleteDescription="删除后正文与阅读历史不可恢复；附件文件仍保留在文件中心。"
        extraFilters={
          <Select
            aria-label="通知状态"
            value={status}
            onChange={setStatus}
            allowClear
            placeholder="全部状态"
            options={notificationStatuses}
          />
        }
        extraToolbar={
          can("notifications:create") &&
          can("users:view") && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => void edit(null)}
            >
              新增通知
            </Button>
          )
        }
        columns={[
          { title: "标题", dataIndex: "title", width: 300 },
          {
            title: "类型",
            dataIndex: "type",
            width: 90,
            render: (v) =>
              notificationTypes.find((t) => t.value === v)?.label ?? v,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (v) => (
              <Tag
                color={
                  v === "PUBLISHED"
                    ? "green"
                    : v === "DRAFT"
                      ? "default"
                      : "orange"
                }
              >
                {notificationStatuses.find((s) => s.value === v)?.label}
              </Tag>
            ),
          },
          {
            title: "接收范围",
            dataIndex: "recipientType",
            width: 120,
            render: (v) => audienceTypes.find((a) => a.value === v)?.label,
          },
          {
            title: "已读 / 接收",
            width: 120,
            render: (_, r) => `${r.readCount} / ${r.recipientCount}`,
          },
          { title: "发布人", dataIndex: "senderName", width: 110 },
          {
            title: "发布时间",
            dataIndex: "publishedAt",
            width: 170,
            render: (v) => (v ? formatTime(v) : "—"),
          },
        ]}
        rowActions={(row) => [
          {
            key: "view",
            label: "查看",
            icon: <Eye size={15} />,
            onClick: () => {
              setSelected(row.id);
              setRecipientPage(1);
            },
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil size={15} />,
            hidden:
              row.status !== "DRAFT" ||
              !own(row) ||
              !can("notifications:update"),
            onClick: () => edit(row),
          },
          {
            key: "copy",
            label: "复制草稿",
            icon: <Copy size={15} />,
            hidden: !own(row) || !can("notifications:create"),
            onClick: () => action(row, "copy"),
          },
          {
            key: "publish",
            label: "发布",
            icon: <Send size={15} />,
            hidden:
              row.status !== "DRAFT" ||
              !own(row) ||
              !can("notifications:publish"),
            confirm: {
              title: "发布这条通知？",
              description:
                "发布时按当前启用人员生成接收名单，发布后的正文不可直接修改。",
            },
            onClick: () => action(row, "publish"),
          },
          {
            key: "withdraw",
            label: "撤回",
            icon: <Undo2 size={15} />,
            danger: true,
            hidden:
              !["PUBLISHED", "EXPIRED"].includes(row.status) ||
              !own(row) ||
              !can("notifications:withdraw"),
            confirm: {
              title: "撤回这条通知？",
              description: "收件人将无法继续查看正文和附件，阅读历史仍保留。",
            },
            onClick: () => action(row, "withdraw"),
          },
        ]}
      />
      <FormModal
        title={editing ? "编辑通知" : "新增通知"}
        open={open}
        form={form}
        width={880}
        okText="保存草稿"
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          await api(
            `/operations/notifications${editing ? `/${editing.id}` : ""}`,
            {
              method: editing ? "PUT" : "POST",
              body: jsonBody({
                ...values,
                recipientIds:
                  values.recipientType === "ALL" ? [] : values.recipientIds,
                attachmentIds: attachmentIds(values.attachments),
                expiresAt: values.expiresAt || null,
                version: editing?.version,
                attachments: undefined,
              }),
            },
          );
          setOpen(false);
          refresh();
          message.success("草稿已保存");
        }}
      >
        {open && (
          <>
            <div className="form-two-columns">
              <Form.Item
                name="type"
                label="通知类型"
                rules={[{ required: true }]}
              >
                <Select options={notificationTypes} />
              </Form.Item>
              <Form.Item
                name="expiresAt"
                label="过期时间"
                extra="留空表示长期有效，按系统时区填写"
              >
                <Input type="datetime-local" />
              </Form.Item>
            </div>
            <Form.Item
              name="title"
              label="标题"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={160} />
            </Form.Item>
            <Form.Item name="summary" label="摘要">
              <Input.TextArea rows={2} maxLength={500} showCount />
            </Form.Item>
            <Form.Item
              name="recipientType"
              label="接收范围"
              rules={[{ required: true }]}
            >
              <Select
                options={audienceTypes.filter(
                  (a) =>
                    a.value !== "ALL" || session?.dataScopes.users === "ALL",
                )}
                onChange={() => form.setFieldValue("recipientIds", [])}
              />
            </Form.Item>
            {recipientType !== "ALL" && (
              <Form.Item
                name="recipientIds"
                label={
                  recipientType === "DEPARTMENTS"
                    ? "接收部门"
                    : recipientType === "ROLES"
                      ? "接收角色"
                      : "接收人员"
                }
                rules={[{ required: true, type: "array", min: 1 }]}
                extra={
                  recipientType === "DEPARTMENTS"
                    ? "仅包含所选部门的直接成员，不自动包含下级部门。"
                    : undefined
                }
              >
                {recipientType === "USERS" ? (
                  <UserSelect
                    mode="multiple"
                    initialOptions={
                      editing && editing.recipientType === recipientType
                        ? editing.recipientOptions
                        : []
                    }
                  />
                ) : (
                  <RecipientGroups
                    kind={recipientType === "ROLES" ? "roles" : "departments"}
                    initialOptions={
                      editing && editing.recipientType === recipientType
                        ? editing.recipientOptions
                        : []
                    }
                  />
                )}
              </Form.Item>
            )}
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
          </>
        )}{" "}
      </FormModal>
      <DetailsModal
        title="通知详情"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={880}
      >
        <QueryState
          children={null}
          loading={detail.isLoading}
          error={detail.error}
          retry={() => void detail.refetch()}
        />
        {detail.data && !detail.isError && (
          <>
            <h3>{detail.data.title}</h3>
            <Descriptions
              column={2}
              items={[
                {
                  key: "sender",
                  label: "发布人",
                  children: detail.data.senderName,
                },
                {
                  key: "state",
                  label: "状态",
                  children: notificationStatuses.find(
                    (s) => s.value === detail.data.status,
                  )?.label,
                },
                {
                  key: "published",
                  label: "发布时间",
                  children: detail.data.publishedAt
                    ? formatTime(detail.data.publishedAt)
                    : "—",
                },
                {
                  key: "expires",
                  label: "过期时间",
                  children: detail.data.expiresAt
                    ? formatTime(detail.data.expiresAt)
                    : "长期有效",
                },
              ]}
            />
            <p className="muted">{detail.data.summary}</p>
            <RichTextView content={detail.data.content} />
            <AttachmentList
              files={detail.data.attachments}
              endpoint={(file) =>
                `/operations/notifications/${selected}/attachments/${file.id}`
              }
            />
            {detail.data.status !== "DRAFT" && (
              <>
                <h4>接收与阅读记录</h4>
                <QueryState
                  children={null}
                  loading={recipients.isLoading}
                  error={recipients.error}
                  retry={() => void recipients.refetch()}
                />
                <DataTable
                  size="small"
                  rowKey="id"
                  dataSource={recipients.data?.items}
                  columns={[
                    { title: "接收人", dataIndex: "name" },
                    {
                      title: "阅读时间",
                      dataIndex: "readAt",
                      render: (v) => (v ? formatTime(v) : "未读"),
                    },
                  ]}
                  pagination={{
                    current: recipientPage,
                    pageSize: 10,
                    total: recipients.data?.total,
                    onChange: setRecipientPage,
                    showSizeChanger: false,
                  }}
                />
              </>
            )}
          </>
        )}
      </DetailsModal>
    </>
  );
}
