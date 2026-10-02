import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Descriptions } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PERSONAL_WORK_POLL_MS } from "../lib/personal-work";
import type { MessageDetail } from "../types/notifications";
import { AttachmentList } from "./AttachmentList";
import { DetailsModal } from "./DetailsModal";
import { RichTextView } from "./RichTextView";
import { QueryState, formatTime } from "./shared";

/** 工作台和收件箱共用详情。每次打开重新鉴权；拿到可读正文后才标记已读，绝不代替审批决定。 */
export function MessageDetailModal({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const { session } = useAuth();
  return id === null ? null : (
    <MessageReader
      key={`${session?.user.id}:${id}`}
      id={id}
      onClose={onClose}
    />
  );
}

function MessageReader({ id, onClose }: { id: number; onClose: () => void }) {
  const { session, can } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const attempted = useRef(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const detail = useQuery({
    queryKey: ["messages", "detail", session?.user.id, id],
    queryFn: () => api<MessageDetail>(`/operations/messages/${id}`),
    refetchInterval: PERSONAL_WORK_POLL_MS,
    // 关闭后释放正文缓存，下次打开必须重新读取，避免撤回后短暂展示旧正文。
    gcTime: 0,
  });
  const markRead = useCallback(async () => {
    setMarking(true);
    setReadError(null);
    try {
      await api(`/operations/messages/${id}/read`, { method: "POST" });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["messages"] }),
        client.invalidateQueries({ queryKey: ["unread"] }),
      ]);
    } catch (error) {
      // 标记失败保留未读状态并提供重试；不能假装成功或因轮询不断弹出错误。
      setReadError((error as Error).message);
    } finally {
      setMarking(false);
    }
  }, [client, id]);
  useEffect(() => {
    // 等待本次重新鉴权完成，不能依据上一回打开时的缓存触发写操作。
    if (
      !detail.data ||
      detail.isFetching ||
      detail.isError ||
      attempted.current
    )
      return;
    attempted.current = true;
    if (!detail.data.delivery.readAt) void markRead();
  }, [detail.data, detail.isFetching, detail.isError, markRead]);

  const target =
    detail.data?.targetType === "CONTENT" && can("notices:view")
      ? "/admin/notices"
      : detail.data?.targetType === "APPROVAL" && can("requests:view")
        ? "/admin/requests"
        : detail.data?.targetType === "FEEDBACK" && can("feedback:view")
          ? "/admin/feedback"
          : detail.data?.targetType === "SCHEDULER" && can("scheduler:view")
            ? "/admin/scheduler"
            : detail.data?.targetType === "MONITOR" && can("monitor:view")
              ? "/admin/monitor"
              : null;
  return (
    <DetailsModal
      title={
        detail.isError
          ? "通知详情"
          : (detail.data?.delivery.title ?? "通知详情")
      }
      open
      onClose={onClose}
      width={800}
    >
      <QueryState
        loading={detail.isLoading}
        error={detail.error}
        retry={() => void detail.refetch()}
      >
        {detail.data && (
          <>
            {readError && (
              <Alert
                type="warning"
                title="未能标记已读"
                description={readError}
                action={
                  <Button loading={marking} onClick={() => void markRead()}>
                    重试
                  </Button>
                }
              />
            )}
            <Descriptions
              column={2}
              items={[
                {
                  key: "sender",
                  label: "发件人",
                  children: detail.data.delivery.senderName,
                },
                {
                  key: "published",
                  label: "发送时间",
                  children: formatTime(detail.data.delivery.publishedAt),
                },
              ]}
            />
            <p className="muted">{detail.data.delivery.summary}</p>
            <RichTextView content={detail.data.content} />
            <AttachmentList
              files={detail.data.attachments}
              endpoint={(file) =>
                `/operations/messages/${id}/attachments/${file.id}`
              }
            />
            {target && detail.data.targetId && (
              <Button
                onClick={() => {
                  onClose();
                  navigate(`${target}?record=${detail.data!.targetId}`);
                }}
              >
                打开关联记录
              </Button>
            )}
          </>
        )}
      </QueryState>
    </DetailsModal>
  );
}
