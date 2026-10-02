import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import type { PageResult } from "../types";
import type { InboxRecord } from "../types/notifications";
import type { ApprovalRecord } from "../types/workflow";
import { useRealtimeUpdates } from "./realtime";

/** 工作台与顶栏共用轮询周期。切回窗口会重新查询；后台标签页停止定时轮询。 */
export const PERSONAL_WORK_POLL_MS = 15000;

/** 未读数按账号隔离缓存，读取后统一失效 messages/unread，避免顶栏与收件箱长期不一致。 */
export function useUnreadCount() {
  useRealtimeUpdates();
  const { session, can } = useAuth();
  return useQuery({
    queryKey: ["unread", session?.user.id],
    queryFn: () => api<number>("/operations/messages/unread"),
    enabled: can("messages:view"),
    refetchInterval: PERSONAL_WORK_POLL_MS,
  });
}

/** 直接使用后端的个人待办/投递查询，不请求全量审批再在浏览器筛选。total 为全部数量，items 仅前三条。 */
export function usePersonalWork() {
  const { session, can } = useAuth();
  const showTasks = can("requests:view") && can("requests:approve");
  const showMessages = can("messages:view");
  const tasks = useQuery({
    queryKey: ["requests", "todo", "home", session?.user.id],
    queryFn: () =>
      api<PageResult<ApprovalRecord>>(
        "/operations/requests?box=todo&page=1&size=3",
      ),
    enabled: showTasks,
    refetchInterval: PERSONAL_WORK_POLL_MS,
  });
  const messages = useQuery({
    queryKey: ["messages", "unread-preview", session?.user.id],
    queryFn: () =>
      api<PageResult<InboxRecord>>(
        "/operations/messages?read=false&page=1&size=3",
      ),
    enabled: showMessages,
    refetchInterval: PERSONAL_WORK_POLL_MS,
  });
  return { tasks, messages, showTasks, showMessages };
}
