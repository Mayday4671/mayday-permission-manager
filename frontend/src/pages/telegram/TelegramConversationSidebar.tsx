import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
} from "@ant-design/icons";
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
        <Typography.Text strong>对话</Typography.Text>
        <Button
          type="text"
          icon={<EditOutlined aria-hidden="true" />}
          disabled={!canCreate}
          loading={creating}
          onClick={onCreate}
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
          items.map((item) => {
            const title = item.title || "未命名对话";
            const selected = item.id === selectedId;
            return (
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
                  <MessageOutlined
                    className="telegram-chat-session-icon"
                    aria-hidden="true"
                  />
                  <span className="telegram-chat-session-copy">
                    <Typography.Text
                      className="telegram-chat-session-title"
                      ellipsis
                    >
                      {title}
                    </Typography.Text>
                    <time
                      className="telegram-chat-session-date"
                      dateTime={item.updatedAt}
                      title={dayjs(item.updatedAt).format("YYYY-MM-DD HH:mm")}
                    >
                      {dayjs(item.updatedAt).format("MM-DD")}
                    </time>
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
