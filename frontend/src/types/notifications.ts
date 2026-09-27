import type { BaseRecord } from "./index";
import type { FileRecord } from "./operations";
import type { LookupOption } from "../components/LookupSelect";

export interface NotificationRecord extends BaseRecord {
  title: string;
  summary: string;
  content: string;
  type: string;
  status: "DRAFT" | "PUBLISHED" | "WITHDRAWN" | "EXPIRED";
  recipientType: "ALL" | "DEPARTMENTS" | "ROLES" | "USERS";
  recipientIds: number[];
  recipientOptions: LookupOption[];
  attachments: FileRecord[];
  senderId: number;
  senderName: string;
  publishedAt: string | null;
  expiresAt: string | null;
  recipientCount: number;
  readCount: number;
  targetType: string | null;
  targetId: number | null;
}
export interface InboxRecord extends BaseRecord {
  notificationId: number;
  title: string;
  summary: string;
  type: string;
  senderName: string;
  publishedAt: string;
  readAt: string | null;
}
export interface MessageDetail {
  delivery: InboxRecord;
  content: string;
  attachments: FileRecord[];
  targetType: string | null;
  targetId: number | null;
}
export const notificationTypes = [
  { value: "NOTICE", label: "通知" },
  { value: "ANNOUNCEMENT", label: "公告" },
  { value: "REMINDER", label: "提醒" },
];
export const notificationStatuses = [
  { value: "DRAFT", label: "草稿" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "WITHDRAWN", label: "已撤回" },
  { value: "EXPIRED", label: "已过期" },
];
export const audienceTypes = [
  { value: "USERS", label: "指定用户" },
  { value: "DEPARTMENTS", label: "指定部门" },
  { value: "ROLES", label: "指定角色" },
  { value: "ALL", label: "全部用户" },
];
