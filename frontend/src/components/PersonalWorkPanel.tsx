import { useState } from "react";
import { Alert, Badge, Button, Skeleton, Tabs } from "antd";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { usePersonalWork } from "../lib/personal-work";
import { ApprovalDetailModal } from "./ApprovalDetailModal";
import { MessageDetailModal } from "./MessageDetailModal";
import { formatTime } from "./shared";

/** 首页集中展示本人当前待办和未读投递；审批操作复用详情弹窗，处理成功后共享查询自动刷新。 */
export function PersonalWorkPanel() {
  const { tasks, messages, showTasks, showMessages } = usePersonalWork();
  const [tab, setTab] = useState("tasks");
  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [messageId, setMessageId] = useState<number | null>(null);
  if (!showTasks && !showMessages) return null;
  // 权限在会话中被撤销时立即切到仍可见的页签，不保留旧缓存卡片或详情。
  const active =
    tab === "tasks"
      ? showTasks
        ? "tasks"
        : "messages"
      : showMessages
        ? "messages"
        : "tasks";
  const items = [
    ...(showTasks
      ? [
          {
            key: "tasks",
            label: (
              <span className="work-tab-label">
                待办审批{" "}
                <Badge
                  className={
                    tasks.data?.total && !tasks.isError
                      ? undefined
                      : "work-count-empty"
                  }
                  showZero
                  overflowCount={99}
                  count={tasks.isError ? "—" : (tasks.data?.total ?? "—")}
                />
              </span>
            ),
            children: (
              <WorkState
                loading={tasks.isLoading}
                error={tasks.error}
                retry={() => void tasks.refetch()}
                empty={!tasks.data?.items.length}
                emptyText="暂无待办审批"
              >
                <ul className="work-list">
                  {tasks.data?.items.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="work-row"
                        onClick={() => setApprovalId(row.id)}
                        aria-label={`处理审批：${row.title}`}
                      >
                        <span className="work-row-main">
                          <strong>{row.title}</strong>
                          <small>
                            {row.applicantName} ·{" "}
                            {row.currentNodeName ?? row.definitionName}
                          </small>
                        </span>
                        <span className="work-row-action">处理</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </WorkState>
            ),
          },
        ]
      : []),
    ...(showMessages
      ? [
          {
            key: "messages",
            label: (
              <span className="work-tab-label">
                未读消息{" "}
                <Badge
                  className={
                    messages.data?.total && !messages.isError
                      ? undefined
                      : "work-count-empty"
                  }
                  showZero
                  overflowCount={99}
                  count={messages.isError ? "—" : (messages.data?.total ?? "—")}
                />
              </span>
            ),
            children: (
              <WorkState
                loading={messages.isLoading}
                error={messages.error}
                retry={() => void messages.refetch()}
                empty={!messages.data?.items.length}
                emptyText="暂无未读消息"
              >
                <ul className="work-list">
                  {messages.data?.items.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="work-row"
                        onClick={() => setMessageId(row.id)}
                        aria-label={`查看消息：${row.title}`}
                      >
                        <span className="work-row-main">
                          <strong>{row.title}</strong>
                          <small>
                            {row.senderName} · {formatTime(row.publishedAt)}
                          </small>
                        </span>
                        <span className="work-row-action">查看</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </WorkState>
            ),
          },
        ]
      : []),
  ];
  return (
    <section className="panel personal-work-panel" aria-label="我的工作">
      <Tabs
        activeKey={active}
        onChange={setTab}
        items={items}
        size="small"
        tabBarExtraContent={
          <Link
            className="text-link"
            aria-label={
              active === "tasks" ? "查看全部待办审批" : "查看全部消息"
            }
            to={active === "tasks" ? "/admin/tasks" : "/admin/messages"}
          >
            全部
          </Link>
        }
      />
      {showTasks && (
        <ApprovalDetailModal
          id={approvalId}
          onClose={() => setApprovalId(null)}
        />
      )}
      {showMessages && (
        <MessageDetailModal id={messageId} onClose={() => setMessageId(null)} />
      )}
    </section>
  );
}

/** 小区域使用紧凑状态，不让空态/加载插画撑高整个首页；失败时不把旧数量冒充为当前数据。 */
function WorkState({
  loading,
  error,
  retry,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: Error | null;
  retry: () => void;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  if (loading) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (error)
    return (
      <Alert
        type="error"
        title="暂时无法加载"
        description={error.message}
        action={
          <Button size="small" onClick={retry}>
            重试
          </Button>
        }
      />
    );
  if (empty) return <div className="dashboard-empty">{emptyText}</div>;
  return children;
}
