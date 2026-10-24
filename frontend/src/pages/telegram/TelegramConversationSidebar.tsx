import { Fragment } from "react";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Pagination, Skeleton, Typography } from "antd";
import dayjs from "dayjs";

/** 服务端按当前用户隔离的会话摘要；一次会话可以包含多轮搜索。 */
export interface TelegramConversationSummary {
  id: number;
  title: string;
  lastKeyword: string | null;
  searchCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TelegramConversationSidebarProps {
  items: TelegramConversationSummary[];
  total: number;
  page: number;
  selectedId?: number;
  loading: boolean;
  error?: string;
  canCreate: boolean;
  canDelete: boolean;
  creating: boolean;
  deletingId?: number;
  onCreate: () => void;
  onSelect: (id: number) => void;
  onDelete: (item: TelegramConversationSummary) => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

const CONVERSATION_PAGE_SIZE = 50;

/** 日期只作为分组标题展示；无效日期归入更早，列表仍保留服务端顺序。 */
function conversationDateGroup(updatedAt: string): string {
  const updated = dayjs(updatedAt);
  if (!updated.isValid()) return "更早";
  const days = dayjs().startOf("day").diff(updated.startOf("day"), "day");
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "近 7 天";
  if (days < 30) return "近 30 天";
  return "更早";
}

/** 会话列表只负责展示和触发操作；确认删除、请求与缓存由页面统一管理。 */
export function TelegramConversationSidebar({
  items,
  total,
  page,
  selectedId,
  loading,
  error,
  canCreate,
  canDelete,
  creating,
  deletingId,
  onCreate,
  onSelect,
  onDelete,
  onRetry,
  onPageChange,
}: TelegramConversationSidebarProps) {
  return (
    <aside className="telegram-chat-sidebar" aria-label="对话列表">
      <header className="telegram-chat-sidebar-header">
        <Button
          type="text"
          icon={<EditOutlined aria-hidden="true" />}
          disabled={!canCreate}
          loading={creating}
          onClick={onCreate}
          aria-label="新对话"
        >
          新对话
        </Button>
      </header>

      <div className="telegram-chat-session-list" aria-busy={loading}>
        {error ? (
          <Alert
            type="error"
            showIcon
            message="对话读取失败"
            description={error}
            action={
              <Button size="small" onClick={onRetry}>
                重试
              </Button>
            }
          />
        ) : loading ? (
          <div role="status" aria-label="正在读取对话">
            <Skeleton active title={false} paragraph={{ rows: 4 }} />
          </div>
        ) : items.length ? (
          items.map((item, index) => {
            const title = item.title || "未命名对话";
            const selected = item.id === selectedId;
            const group = conversationDateGroup(item.updatedAt);
            const startsGroup =
              index === 0 ||
              conversationDateGroup(items[index - 1].updatedAt) !== group;
            return (
              <Fragment key={item.id}>
                {startsGroup && (
                  <h3 className="telegram-chat-session-group">{group}</h3>
                )}
                <div
                  className={`telegram-chat-session${selected ? " is-selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="telegram-chat-session-select"
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(item.id)}
                    title={title}
                  >
                    <span className="telegram-chat-session-copy">
                      <Typography.Text
                        className="telegram-chat-session-title"
                        ellipsis
                      >
                        {title}
                      </Typography.Text>
                    </span>
                  </button>
                  {canDelete ? (
                    <Button
                      className="telegram-chat-session-delete"
                      type="text"
                      size="small"
                      aria-label={`删除对话：${title}`}
                      title="删除对话"
                      icon={<DeleteOutlined aria-hidden="true" />}
                      loading={deletingId === item.id}
                      disabled={
                        deletingId !== undefined && deletingId !== item.id
                      }
                      onClick={() => onDelete(item)}
                    />
                  ) : null}
                </div>
              </Fragment>
            );
          })
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有对话"
          />
        )}
      </div>

      {total > CONVERSATION_PAGE_SIZE ? (
        <Pagination
          className="telegram-chat-session-pagination"
          size="small"
          current={page}
          pageSize={CONVERSATION_PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          showLessItems
          onChange={onPageChange}
        />
      ) : null}
    </aside>
  );
}
