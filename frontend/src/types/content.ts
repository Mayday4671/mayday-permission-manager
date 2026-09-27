import type { BaseRecord } from "./index";
import type { FileRecord } from "./operations";
import type { LookupOption } from "../components/LookupSelect";

export interface ContentRevision {
  revisionId: number;
  revisionNumber: number;
  title: string;
  categoryId: number;
  category: string;
  summary: string;
  content: string;
  contentFormat: "HTML";
  tagIds: number[];
  tags: string[];
  tagOptions: LookupOption[];
  visibility: "PUBLIC" | "INTERNAL";
  coverId: number | null;
  cover: FileRecord | null;
  attachments: FileRecord[];
  attachmentIds: number[];
  sortOrder: number;
  pinned: boolean;
  recommended: boolean;
  seoTitle: string;
  seoKeywords: string;
  seoDescription: string;
  approvalStatus: string;
  approvalRequestId: number | null;
  editorName: string;
  revisedAt: string;
}
export interface ContentRecord extends BaseRecord, ContentRevision {
  status: string;
  published: boolean;
  publiclyVisible: boolean;
  authorName: string;
  authorId: number;
  departmentId: number | null;
  requiresApproval: boolean;
  effectiveApprovalRequired: boolean;
  liveRevisionId: number | null;
  publishedAt: string | null;
  liveOfflineAt: string | null;
  deletedAt: string | null;
  scheduledPublishAt: string | null;
  scheduledOfflineAt: string | null;
  scheduleError: string | null;
  viewCount: number;
}
export const contentStatuses = [
  { value: "DRAFT", label: "草稿" },
  { value: "PENDING", label: "待审核" },
  { value: "APPROVED", label: "审核通过" },
  { value: "SCHEDULED", label: "待上线" },
  { value: "PUBLISHED", label: "已上线" },
  { value: "OFFLINE", label: "已下线" },
];
export interface Publication extends BaseRecord {
  revisionId: number;
  publishedAt: string;
  offlineAt: string | null;
  operatorName: string;
  reason: string;
}
