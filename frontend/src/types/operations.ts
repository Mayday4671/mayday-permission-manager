import type { BaseRecord } from "./index";
export interface MessageRecord extends BaseRecord {
  title: string;
  content: string;
  senderId: number;
  senderName: string;
  recipientId: number;
  readAt: string | null;
}
export interface FileRecord extends BaseRecord {
  name: string;
  size: number;
  ownerId: number;
  ownerName: string;
  contentType: string;
  directoryId: number | null;
  storageProvider: "MYSQL" | "LOCAL" | "S3";
  deletedAt: string | null;
  purgeRequestedAt: string | null;
  purgeError: string | null;
}
/** 业务目录只控制文件组织，不改变所有者或附件原有的访问授权。 */
export interface FileDirectory extends BaseRecord {
  name: string;
  parentId: number;
  ownerId: number;
  ownerName: string;
}
export interface SessionRecord extends BaseRecord<string> {
  username: string;
  nickname: string;
  lastActiveAt: string;
  expiresAt: string;
  ip: string;
  device: string;
  current: boolean;
}
export interface ScheduledJob extends BaseRecord {
  name: string;
  handler: string;
  cron: string;
  description: string;
  enabled: boolean;
  nextRunAt: string | null;
}
export interface JobExecution extends BaseRecord {
  jobId: number;
  jobName: string;
  status: string;
  result: string;
  durationMs: number;
}
export interface FlowDefinition extends BaseRecord {
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  approverIds: number[];
}
export interface FlowRequest extends BaseRecord {
  title: string;
  content: string;
  definitionId: number;
  definitionName: string;
  applicantId: number;
  applicantName: string;
  status: string;
  currentStep: number;
  currentApproverId: number | null;
  approverIds: number[];
}
export interface FlowDecision extends BaseRecord {
  actorName: string;
  action: string;
  comment: string;
}
export interface PersonOption {
  id: number;
  name: string;
  username: string;
}
