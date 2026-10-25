import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AgentScopeSettingsPage } from "./AgentScopeSettingsPage";
import "./agentscope.css";

interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

interface StatusView {
  enabled: boolean;
  modelReady: boolean;
  version: string;
  requestTimeoutSeconds: number;
  maxMessageLength: number;
  contextMessageCount: number;
}

interface ConversationView {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

interface MessageView {
  id: number;
  role: "USER" | "ASSISTANT";
  content: string;
  status: "PROCESSING" | "COMPLETE" | "FAILED";
  createdAt: string;
}

interface TurnView {
  user: MessageView;
  assistant: MessageView;
}

const PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 50;

/** Provides a plain-text, owner-scoped chat interface over the separately switchable AgentScope module. */
export function AgentScopePage() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const client = useQueryClient();
  const [conversationPage, setConversationPage] = useState(1);
  const [messagePage, setMessagePage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const retryRequest = useRef<{ content: string; id: string } | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ["agentscope", "status"],
    queryFn: () => api<StatusView>("/agentscope/status"),
  });
  const conversations = useQuery({
    queryKey: ["agentscope", "conversations", conversationPage],
    queryFn: () =>
      api<PageResult<ConversationView>>(
        `/agentscope/conversations?page=${conversationPage}&size=${PAGE_SIZE}`,
      ),
  });
  const records = conversations.data?.items ?? [];
  const active = records.find((record) => record.id === selectedId) ?? null;
  const messages = useQuery({
    queryKey: ["agentscope", "messages", selectedId, messagePage],
    queryFn: () =>
      api<PageResult<MessageView>>(
        `/agentscope/conversations/${selectedId}/messages?page=${messagePage}&size=${MESSAGE_PAGE_SIZE}`,
      ),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    if (selectedId === null && records.length > 0) setSelectedId(records[0].id);
  }, [records, selectedId]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.data?.items, pendingText]);

  /** Starts an empty server-owned conversation and selects it after persistence succeeds. */
  async function createConversation() {
    setCreating(true);
    try {
      const created = await api<ConversationView>("/agentscope/conversations", {
        method: "POST",
      });
      await client.invalidateQueries({
        queryKey: ["agentscope", "conversations"],
      });
      setSelectedId(created.id);
      setMessagePage(1);
      retryRequest.current = null;
      message.success("已新建会话");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  /** Removes only the selected account's idle conversation and its stored context. */
  async function deleteConversation(id: number) {
    setDeletingId(id);
    try {
      await api<void>(`/agentscope/conversations/${id}`, { method: "DELETE" });
      const next = records.find((record) => record.id !== id)?.id ?? null;
      if (selectedId === id) {
        setSelectedId(next);
        setMessagePage(1);
      }
      await client.invalidateQueries({
        queryKey: ["agentscope", "conversations"],
      });
      message.success("会话已删除");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  /** Sends bounded plain text with an idempotency key retained for a user retry. */
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedId || !content || !status.data?.modelReady || sending) return;
    const requestId =
      retryRequest.current?.content === content
        ? retryRequest.current.id
        : crypto.randomUUID();
    retryRequest.current = { content, id: requestId };
    setPendingText(content);
    setSending(true);
    try {
      await api<TurnView>(
        `/agentscope/conversations/${selectedId}/messages`,
        {
          method: "POST",
          body: jsonBody({ content, requestId }),
        },
        ((status.data.requestTimeoutSeconds ?? 120) + 15) * 1000,
      );
      setDraft("");
      setMessagePage(1);
      retryRequest.current = null;
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["agentscope", "messages", selectedId],
        }),
        client.invalidateQueries({ queryKey: ["agentscope", "conversations"] }),
      ]);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setPendingText(null);
      setSending(false);
    }
  }

  /** Sends on Enter while keeping Shift+Enter available for multiline messages. */
  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const chronologicalMessages = [...(messages.data?.items ?? [])].reverse();
  const modelReady = status.data?.modelReady === true;

  return (
    <section className="agent-scope-page">
      <header className="agent-scope-heading">
        <div className="agent-scope-heading-actions">
          {can("agentscope:configure") && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              模型设置
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={creating}
            onClick={createConversation}
          >
            新建会话
          </Button>
        </div>
      </header>

      {can("agentscope:configure") && (
        <Modal
          title="智能体模型设置"
          open={settingsOpen}
          width={800}
          footer={null}
          destroyOnHidden
          onCancel={() => setSettingsOpen(false)}
          styles={{
            body: { maxHeight: "calc(100vh - 150px)", overflowY: "auto" },
          }}
        >
          <AgentScopeSettingsPage onSaved={() => setSettingsOpen(false)} />
        </Modal>
      )}

      {status.data && !modelReady && (
        <Alert
          className="agent-scope-readiness"
          type="warning"
          showIcon
          message="模型服务尚未配置"
          description={
            can("agentscope:configure")
              ? "点击右上角“模型设置”选择常用模型或输入模型 ID，并填写百炼 API Key；保存后立即生效。"
              : "请联系拥有智能体配置权限的管理员完成模型设置。"
          }
        />
      )}

      <div className="agent-scope-workspace">
        <Card
          className="agent-scope-conversations"
          styles={{ body: { padding: 0 } }}
        >
          <div className="agent-scope-list-heading">
            <Typography.Text strong>我的会话</Typography.Text>
            <Typography.Text type="secondary">
              {conversations.data?.total ?? 0}
            </Typography.Text>
          </div>
          <div className="agent-scope-conversation-list">
            {conversations.isLoading ? (
              <div className="agent-scope-loading">
                <Spin />
              </div>
            ) : records.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有会话"
              />
            ) : (
              records.map((record) => (
                <div
                  key={record.id}
                  className={`agent-scope-conversation${selectedId === record.id ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="agent-scope-conversation-select"
                    onClick={() => {
                      setSelectedId(record.id);
                      setMessagePage(1);
                      retryRequest.current = null;
                    }}
                    aria-current={selectedId === record.id ? "page" : undefined}
                  >
                    <MessageOutlined />
                    <span className="agent-scope-conversation-copy">
                      <span className="agent-scope-conversation-title">
                        {record.title}
                      </span>
                      <span className="agent-scope-conversation-date">
                        {formatDate(record.lastMessageAt ?? record.createdAt)}
                      </span>
                    </span>
                  </button>
                  <Popconfirm
                    title="删除这个会话？"
                    description="删除后，对话内容和对应的模型上下文都会被清除。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => deleteConversation(record.id)}
                  >
                    <Tooltip title="删除会话">
                      <Button
                        type="text"
                        size="small"
                        danger
                        loading={deletingId === record.id}
                        icon={<DeleteOutlined />}
                        aria-label={`删除会话：${record.title}`}
                      />
                    </Tooltip>
                  </Popconfirm>
                </div>
              ))
            )}
          </div>
          {(conversations.data?.total ?? 0) > PAGE_SIZE && (
            <div className="agent-scope-list-pagination">
              <Pagination
                size="small"
                current={conversationPage}
                pageSize={PAGE_SIZE}
                total={conversations.data?.total ?? 0}
                showSizeChanger={false}
                onChange={setConversationPage}
              />
            </div>
          )}
        </Card>

        <Card className="agent-scope-chat" styles={{ body: { padding: 0 } }}>
          {active ? (
            <>
              <div className="agent-scope-chat-heading">
                <div>
                  <Typography.Text strong>{active.title}</Typography.Text>
                  <Typography.Text type="secondary">
                    {modelReady
                      ? `上下文保留最近 ${status.data?.contextMessageCount ?? 40} 条消息`
                      : "等待模型服务配置"}
                  </Typography.Text>
                </div>
                <Tag color={modelReady ? "green" : "default"}>
                  {modelReady
                    ? "服务可用"
                    : status.isLoading
                      ? "检查中"
                      : "未配置"}
                </Tag>
              </div>
              <div className="agent-scope-transcript" aria-live="polite">
                {messages.isLoading ? (
                  <div className="agent-scope-loading">
                    <Spin />
                  </div>
                ) : chronologicalMessages.length === 0 &&
                  pendingText === null ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="发送一条消息，开始这个会话"
                  />
                ) : (
                  <>
                    {chronologicalMessages.map((record) => (
                      <article
                        key={record.id}
                        className={`agent-scope-message is-${record.role.toLowerCase()}`}
                      >
                        <Avatar size={30} className="agent-scope-avatar">
                          {record.role === "USER" ? "我" : "M"}
                        </Avatar>
                        <div className="agent-scope-message-body">
                          <div className="agent-scope-message-meta">
                            <Typography.Text strong>
                              {record.role === "USER" ? "我" : "Mayday 助手"}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                              {formatDate(record.createdAt)}
                            </Typography.Text>
                          </div>
                          <div className="agent-scope-message-content">
                            {record.content}
                          </div>
                        </div>
                      </article>
                    ))}
                    {pendingText !== null && (
                      <article className="agent-scope-message is-user is-pending">
                        <Avatar size={30} className="agent-scope-avatar">
                          我
                        </Avatar>
                        <div className="agent-scope-message-body">
                          <div className="agent-scope-message-meta">
                            <Typography.Text strong>我</Typography.Text>
                          </div>
                          <div className="agent-scope-message-content">
                            {pendingText}
                          </div>
                        </div>
                      </article>
                    )}
                    {sending && (
                      <div className="agent-scope-generating">
                        <Spin size="small" /> 正在生成回复…
                      </div>
                    )}
                    <div ref={transcriptEnd} />
                  </>
                )}
              </div>
              <div className="agent-scope-history-footer">
                <Typography.Text type="secondary">
                  {messages.data ? `${messages.data.total} 条消息` : ""}
                </Typography.Text>
                {(messages.data?.total ?? 0) > MESSAGE_PAGE_SIZE && (
                  <Pagination
                    size="small"
                    current={messagePage}
                    pageSize={MESSAGE_PAGE_SIZE}
                    total={messages.data?.total ?? 0}
                    showSizeChanger={false}
                    onChange={setMessagePage}
                  />
                )}
              </div>
              <form className="agent-scope-composer" onSubmit={sendMessage}>
                <Input.TextArea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={submitOnEnter}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  maxLength={status.data?.maxMessageLength ?? 4000}
                  showCount
                  disabled={!modelReady || sending}
                  placeholder={
                    modelReady
                      ? "输入消息，Enter 发送，Shift + Enter 换行"
                      : "配置模型服务后可以开始对话"
                  }
                />
                <div className="agent-scope-composer-footer">
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    loading={sending}
                    disabled={!modelReady || !draft.trim() || sending}
                  >
                    发送
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="agent-scope-empty-chat">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  records.length > 0 ? "选择左侧会话继续" : "新建会话后即可开始"
                }
              >
                {records.length === 0 && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    loading={creating}
                    onClick={createConversation}
                  >
                    新建会话
                  </Button>
                )}
              </Empty>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
