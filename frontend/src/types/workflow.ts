import type { BaseRecord } from "./index";
import type { ContentRevision } from "./content";
import type { FileRecord } from "./operations";

/** 与 Java WorkflowSchema 对齐的唯一前端契约。稳定字段/节点 ID 不依赖显示名称。 */
export type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "MONEY"
  | "DATE"
  | "SINGLE"
  | "MULTI"
  | "USER"
  | "DEPARTMENT"
  | "FILES";
export interface WorkflowField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  width?: 12 | 24;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
}
export interface WorkflowCondition {
  field: string;
  operator: "EQ" | "NE" | "GT" | "GE" | "LT" | "LE" | "CONTAINS";
  value: string;
  next: string;
}
export type WorkflowAction =
  "APPROVE" | "REJECT" | "COMMENT" | "WITHDRAW" | "TRANSFER" | "ADD_SIGN";
export interface WorkflowNode {
  id: string;
  name: string;
  type: "APPROVAL" | "CONDITION" | "END";
  next?: string;
  source?: "USERS" | "ROLES" | "DEPARTMENT_LEADER";
  assigneeIds?: number[];
  mode?: "ANY" | "ALL";
  readable?: string[];
  writable?: string[];
  actions?: WorkflowAction[];
  conditions?: WorkflowCondition[];
}
export interface WorkflowSpec {
  fields: WorkflowField[];
  nodes: WorkflowNode[];
  startNodeId: string;
  applicantType: "ALL" | "USERS" | "ROLES" | "DEPARTMENTS";
  applicantIds: number[];
  allowSelfApproval: boolean;
  allowRepeatApproval: boolean;
  allowWithdraw: boolean;
}
export interface WorkflowDefinition extends BaseRecord {
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  categoryId: number;
  category: string;
  businessType: "GENERAL" | "CONTENT";
  schema: WorkflowSpec;
  personOptions?: { value: number; label: string }[];
  publishedVersionId: number | null;
  publishedVersion: number | null;
}
export interface WorkflowOption {
  id: number;
  name: string;
  businessType: "GENERAL" | "CONTENT";
  categoryId: number;
  versionId: number;
  versionNumber: number;
  fields: WorkflowField[];
}
export interface WorkflowTask extends BaseRecord {
  nodeId: string;
  nodeName: string;
  assigneeId: number;
  assigneeName: string;
  status: string;
  mandatory: boolean;
  decidedAt: string | null;
}
export interface WorkflowHistory extends BaseRecord {
  actorName: string;
  action: string;
  comment: string | null;
  nodeName: string | null;
  targetUserName: string | null;
  changes?: Record<string, { before: unknown; after: unknown }>;
}
export interface ApprovalRecord extends BaseRecord {
  title: string;
  definitionName: string;
  definitionId: number;
  definitionVersionId: number;
  definitionVersionNumber?: number;
  applicantId: number;
  applicantName: string;
  status: string;
  businessType: string;
  businessId: number | null;
  businessRevisionId: number | null;
  currentNodeName: string | null;
  completedAt: string | null;
}
export interface ApprovalDetail extends ApprovalRecord {
  fields: WorkflowField[];
  values: Record<string, unknown>;
  valueLabels: Record<string, string>;
  files: FileRecord[];
  tasks: WorkflowTask[];
  history: WorkflowHistory[];
  myTaskId: number | null;
  actions: WorkflowAction[];
  writable: string[];
  canWithdraw: boolean;
  canComment: boolean;
  business:
    | (ContentRevision & {
        noticeId: number;
        currentRevision: boolean;
        deleted: boolean;
      })
    | null;
}
export const approvalStates: Record<string, string> = {
  PENDING: "审批中",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤回",
  CANCELLED: "已取消",
  TRANSFERRED: "已转交",
};
export const actionNames: Record<string, string> = {
  SUBMIT: "提交",
  APPROVE: "同意",
  REJECT: "驳回",
  WITHDRAW: "撤回",
  COMMENT: "评论",
  TRANSFER: "转交",
  ADD_SIGN: "加签",
};
export const fieldNames: Record<FieldType, string> = {
  TEXT: "单行文字",
  TEXTAREA: "多行文字",
  NUMBER: "数字",
  MONEY: "金额",
  DATE: "日期",
  SINGLE: "单选",
  MULTI: "多选",
  USER: "人员",
  DEPARTMENT: "部门",
  FILES: "附件",
};
export function initialSpec(): WorkflowSpec {
  return {
    fields: [
      {
        id: "description",
        label: "申请说明",
        type: "TEXTAREA",
        required: true,
        width: 24,
        maxLength: 2000,
      },
    ],
    nodes: [
      {
        id: "review",
        name: "审批",
        type: "APPROVAL",
        source: "USERS",
        assigneeIds: [],
        mode: "ALL",
        next: "end",
        readable: ["description"],
        writable: [],
        actions: ["APPROVE", "REJECT", "COMMENT"],
        conditions: [],
      },
      { id: "end", name: "结束", type: "END" },
    ],
    startNodeId: "review",
    applicantType: "ALL",
    applicantIds: [],
    allowSelfApproval: false,
    allowRepeatApproval: false,
    allowWithdraw: true,
  };
}
