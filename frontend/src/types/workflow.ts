import type { BaseRecord } from "./index";
import type { ContentRevision } from "./content";
import type { FileRecord } from "./operations";

/** 与 Java WorkflowSchema 对齐的唯一前端契约。稳定字段/节点 ID 不依赖显示名称。 */
export type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "MONEY"
  | "CALCULATED"
  | "DATE"
  | "DATETIME"
  | "DATE_RANGE"
  | "DETAILS"
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
  placeholder?: string;
  helpText?: string;
  columns?: WorkflowField[];
  maxRows?: number;
  formula?: WorkflowFormula | null;
}
/** 结构化计算规则对应 Java 的白名单运算，顺序影响减法和除法；结果始终由服务器重算。 */
export interface WorkflowFormula {
  operation:
    "SUM" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "DETAIL_SUM" | "DATE_DAYS";
  operands: string[];
  column?: string;
  scale: number;
}
export interface WorkflowCondition {
  field?: string;
  operator?: WorkflowConditionRule["operator"];
  value?: string;
  next: string;
  predicate?: WorkflowConditionRule | null;
}
/** 分组只配置 logic/children；叶子只配置字段/比较/值，最多 3 层、20 条判断。 */
export interface WorkflowConditionRule {
  field?: string;
  operator?: "EQ" | "NE" | "GT" | "GE" | "LT" | "LE" | "CONTAINS";
  value?: string;
  logic?: "AND" | "OR";
  children?: WorkflowConditionRule[];
}
export type WorkflowAction =
  | "APPROVE"
  | "REJECT"
  | "RETURN"
  | "TERMINATE"
  | "COMMENT"
  | "WITHDRAW"
  | "TRANSFER"
  | "ADD_SIGN";
export interface WorkflowNode {
  id: string;
  name: string;
  type: "APPROVAL" | "COPY" | "CONDITION" | "END";
  next?: string;
  source?: "USERS" | "ROLES" | "DEPARTMENT_LEADER";
  assigneeIds?: number[];
  mode?: "ANY" | "ALL" | "SERIAL";
  readable?: string[];
  writable?: string[];
  actions?: WorkflowAction[];
  conditions?: WorkflowCondition[];
  /** 节点进入后计算期限，留空不提醒；同一任务最多一次自动超时提醒。 */
  timeoutMinutes?: number | null;
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
  originalAssigneeId?: number | null;
  originalAssigneeName?: string | null;
  delegationId?: number | null;
  assignmentNote?: string | null;
  status: string;
  mandatory: boolean;
  decidedAt: string | null;
  dueAt: string | null;
  timeoutNotifiedAt: string | null;
  runNumber: number;
  nodeVisit: number;
  kind: "APPROVAL" | "COPY";
  readAt: string | null;
}
export interface WorkflowHistory extends BaseRecord {
  actorName: string;
  action: string;
  comment: string | null;
  nodeName: string | null;
  targetUserName: string | null;
  changes?: Record<string, { before: unknown; after: unknown }>;
  runNumber: number;
  nodeVisit: number;
  targetNodeId?: string;
  submittedValues?: Record<string, unknown>;
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
  lastRemindedAt: string | null;
  runNumber: number;
  submittedAt: string | null;
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
  canRemind: boolean;
  canEdit: boolean;
  canTerminate: boolean;
  canHandover?: boolean;
  handoverSources?: { value: number; label: string }[];
  returnTargets: { id: string; name: string }[];
  unreadCopies: number;
  diagram: {
    startNodeId: string;
    nodes: {
      id: string;
      name: string;
      type: WorkflowNode["type"];
      next?: string;
      branches: string[];
      current: boolean;
      visited: boolean;
    }[];
  };
  business:
    | (ContentRevision & {
        noticeId: number;
        currentRevision: boolean;
        deleted: boolean;
        noticeVersion: number;
      })
    | null;
}
export const approvalStates: Record<string, string> = {
  PENDING: "审批中",
  DRAFT: "草稿",
  RETURNED: "已退回",
  WAITING: "未轮到",
  COPIED: "已抄送",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤回",
  CANCELLED: "已失效",
  TRANSFERRED: "已转交",
};
export const actionNames: Record<string, string> = {
  SUBMIT: "提交",
  APPROVE: "同意",
  REJECT: "驳回",
  RETURN: "退回",
  TERMINATE: "终止",
  RESUBMIT: "重新提交",
  EDIT: "保存修改",
  WITHDRAW: "撤回",
  COMMENT: "评论",
  TRANSFER: "转交",
  ADD_SIGN: "加签",
  REMIND: "催办",
  DELEGATE: "委托",
  HANDOVER: "人员交接",
};
export const fieldNames: Record<FieldType, string> = {
  TEXT: "单行文字",
  TEXTAREA: "多行文字",
  NUMBER: "数字",
  MONEY: "金额",
  CALCULATED: "计算字段",
  DATE: "日期",
  DATETIME: "日期时间",
  DATE_RANGE: "日期区间",
  DETAILS: "明细表",
  SINGLE: "单选",
  MULTI: "多选",
  USER: "人员",
  DEPARTMENT: "部门",
  FILES: "附件",
};
/** 空白草稿提供最小可编辑骨架；审批人未指定时禁止发布，默认不自审或重复审批。 */
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
        actions: ["APPROVE", "REJECT", "RETURN", "COMMENT"],
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
