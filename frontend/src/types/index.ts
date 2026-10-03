/** 前后端共用的协议形状。业务页面不能使用 any 绕过字段校验。 */
export interface BaseRecord<Id extends string | number = number> {
  id: Id;
  createdAt: string;
  updatedAt?: string;
  version: number;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}
export interface User extends BaseRecord {
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  departmentName: string;
  enabled: boolean;
  roleIds: number[];
  roleNames: string[];
  postIds: number[];
}
export type DataScope =
  "SELF" | "DEPARTMENT" | "DEPARTMENT_TREE" | "CUSTOM" | "ALL";
export interface Role extends BaseRecord {
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  permissions: string[];
  dataScopes: Record<string, DataScope>;
  scopeDepartments: { resource: string; departmentId: number }[];
}
export interface Entry extends BaseRecord {
  kind: string;
  name: string;
  code: string;
  value: string;
  description: string;
  permission: string;
  path: string;
  parentId: number | null;
  leaderId?: number | null;
  icon?: string | null;
  groupName?: string;
  valueType?: string;
  builtIn?: boolean;
  sortOrder: number;
  enabled: boolean;
}
export interface Notice extends BaseRecord {
  title: string;
  category: string;
  summary: string;
  content: string;
  published: boolean;
  tags: string[];
  deletedAt?: string | null;
  authorId: number;
  authorName: string;
  departmentId: number | null;
}
export interface Article {
  portalChannelId: number;
  channelCode: string;
  channelName: string;
  channelTemplate: "GUIDE" | "NOTICE" | "UPDATE" | "STORY";
  id: number;
  title: string;
  category: string;
  summary: string;
  content: string | null;
  authorName: string;
  createdAt: string;
  categoryId: number;
  tags: { id: number; name: string }[];
  viewCount: number;
  pinned: boolean;
  recommended: boolean;
  coverUrl: string | null;
  seoTitle: string;
  seoKeywords: string;
  seoDescription: string;
  attachments?: { id: number; name: string; size: number; url: string }[];
}
export interface AuditLog extends BaseRecord {
  username: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string;
}
export interface AuthSession {
  user: User;
  permissions: string[];
  dataScopes: Record<string, DataScope>;
  admin: boolean;
}
export interface PermissionGroup {
  key: string;
  name: string;
  actions: Record<string, string>;
  scoped: boolean;
}
export interface Lookups {
  posts: { id: number; name: string }[];
  departments: {
    id: number;
    name: string;
    parentId: number | null;
    enabled: boolean;
  }[];
  roles: { id: number; name: string; code: string }[];
}
export interface DashboardData {
  users: number | null;
  roles: number | null;
  departments: number | null;
  notices: number | null;
  published: number | null;
  trend: { date: string; count: number }[];
  recentLogs: AuditLog[];
  recentNotices: Notice[];
}
