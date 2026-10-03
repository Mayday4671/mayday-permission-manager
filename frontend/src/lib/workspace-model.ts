/** 页签只接受已实现的后台路由；不从浏览器存储恢复任意地址或权限信息。 */
export const adminPages = [
  {
    path: "/admin/portal",
    title: "门户栏目",
    permission: "portal:view",
    screen: "portalStructure",
    group: "内容管理",
    icon: "notices",
  },
  {
    path: "/admin/feedback",
    title: "客户反馈",
    permission: "feedback:view",
    screen: "feedback",
    group: "客户服务",
    icon: "notices",
  },
  {
    path: "/admin/scheduler",
    title: "任务调度",
    permission: "scheduler:view",
    screen: "scheduler",
    group: "系统管理",
    icon: "settings",
  },
  {
    path: "/admin/monitor",
    title: "服务监控",
    permission: "monitor:view",
    screen: "monitor",
    group: "系统管理",
    icon: "dashboard",
  },
  {
    path: "/admin/sessions",
    title: "在线会话",
    permission: "sessions:view",
    screen: "sessions",
    group: "系统管理",
    icon: "users",
  },
  {
    path: "/admin/changes",
    title: "变更记录",
    permission: "logs:view",
    screen: "changes",
    group: "系统管理",
    icon: "logs",
  },
  {
    path: "/admin/workorders",
    title: "工单管理",
    permission: "workorders:view",
    screen: "workorders",
    group: "独立入口",
    icon: "notices",
  },
  // generator:frontend-pages
  {
    path: "/admin/udp-relay",
    title: "UDP 转发",
    permission: "relay:view",
    screen: "udpRelay",
    group: "独立入口",
    icon: "settings",
  },
  {
    path: "/admin/crawler",
    title: "采集数据",
    permission: "crawler:view",
    screen: "crawlerData",
    group: "内容管理",
    icon: "notices",
  },
  {
    path: "/admin/crawler-config",
    title: "采集配置",
    permission: "crawler:view",
    screen: "crawlerConfig",
    group: "内容管理",
    icon: "settings",
  },
  {
    path: "/admin/approval-categories",
    title: "审批分类",
    permission: "approvalcategories:view",
    screen: "entries",
    kind: "approvalcategories",
    group: "审批中心",
    icon: "dictionaries",
  },
  {
    path: "/admin/workflows",
    title: "流程定义",
    permission: "workflows:view",
    screen: "workflows",
    group: "审批中心",
    icon: "roles",
  },
  {
    path: "/admin/requests",
    title: "审批申请",
    permission: "requests:view",
    screen: "requests",
    group: "审批中心",
    icon: "notices",
  },
  {
    path: "/admin/tasks",
    title: "审批待办",
    permission: "requests:approve",
    screen: "approvalTasks",
    group: "审批中心",
    icon: "roles",
  },
  {
    path: "/admin/workflow-designer",
    title: "流程设计",
    permission: "workflows:view",
    screen: "workflowDesigner",
    group: "审批中心",
    icon: "roles",
  },
  {
    path: "/admin/categories",
    title: "内容分类",
    permission: "categories:view",
    screen: "entries",
    kind: "categories",
    group: "内容管理",
    icon: "dictionaries",
  },
  {
    path: "/admin/tags",
    title: "内容标签",
    permission: "tags:view",
    screen: "entries",
    kind: "tags",
    group: "内容管理",
    icon: "dictionaries",
  },
  {
    path: "/admin/recycle",
    title: "内容回收站",
    permission: "notices:view",
    screen: "recycle",
    group: "内容管理",
    icon: "notices",
  },
  {
    path: "/admin/notifications",
    title: "通知管理",
    permission: "notifications:view",
    screen: "notifications",
    group: "通知中心",
    icon: "notices",
  },
  {
    path: "/admin/messages",
    title: "个人收件箱",
    permission: "messages:view",
    screen: "messages",
    group: "通知中心",
    icon: "notices",
  },
  {
    path: "/admin/files",
    title: "文件中心",
    permission: "files:view",
    screen: "files",
    group: "系统管理",
    icon: "dictionaries",
  },
  {
    path: "/admin",
    title: "工作台",
    permission: "dashboard:view",
    screen: "dashboard",
    group: "概览",
    icon: "dashboard",
  },
  {
    path: "/admin/users",
    title: "用户管理",
    permission: "users:view",
    screen: "users",
    group: "系统管理",
    icon: "users",
  },
  {
    path: "/admin/roles",
    title: "角色权限",
    permission: "roles:view",
    screen: "roles",
    group: "系统管理",
    icon: "roles",
  },
  {
    path: "/admin/departments",
    title: "组织部门",
    permission: "departments:view",
    screen: "entries",
    kind: "departments",
    group: "工作空间",
    icon: "departments",
  },
  {
    path: "/admin/notices",
    title: "内容中心",
    permission: "notices:view",
    screen: "notices",
    group: "内容管理",
    icon: "notices",
  },
  {
    path: "/admin/posts",
    title: "岗位管理",
    permission: "posts:view",
    screen: "entries",
    kind: "posts",
    group: "工作空间",
    icon: "users",
  },
  {
    path: "/admin/menus",
    title: "菜单管理",
    permission: "menus:view",
    screen: "entries",
    kind: "menus",
    group: "系统管理",
    icon: "menus",
  },
  {
    path: "/admin/dictionaries",
    title: "数据字典",
    permission: "dictionaries:view",
    screen: "dictionaries",
    group: "系统管理",
    icon: "dictionaries",
  },
  {
    path: "/admin/settings",
    title: "系统参数",
    permission: "settings:view",
    screen: "settings",
    group: "系统管理",
    icon: "settings",
  },
  {
    path: "/admin/logs",
    title: "操作日志",
    permission: "logs:view",
    screen: "logs",
    group: "系统管理",
    icon: "logs",
  },
  {
    path: "/admin/profile",
    title: "个人中心",
    permission: null,
    screen: "profile",
    group: "个人",
    icon: "users",
  },
  {
    path: "/admin/login-logs",
    title: "登录日志",
    permission: "loginlogs:view",
    screen: "loginlogs",
    group: "系统管理",
    icon: "logs",
  },
  {
    path: "/admin/user-statistics",
    title: "用户统计",
    permission: "userstats:view",
    screen: "userstats",
    group: "系统管理",
    icon: "dashboard",
  },
  {
    path: "/admin/site-settings",
    title: "网站配置",
    permission: "settings:view",
    screen: "site",
    group: "系统管理",
    icon: "settings",
  },
] as const;

/**
 * 后台返回地址只接受已实现的本机页面；流程设计 ID 和审批详情 record 允许正整数。
 * 查询串不能恢复令牌、跳转地址、表单草稿或任意参数；路由和后端仍独立检查访问权限。
 */
export function adminRouteTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([/a-z-]+)(?:\?([^#]*))?$/.exec(value);
  if (!match) return undefined;
  const path = match[1].replace(/\/$/, "");
  if (!adminPages.some((page) => page.path === path)) return undefined;
  const key =
    path === "/admin/workflow-designer"
      ? "id"
      : path === "/admin/requests" || path === "/admin/tasks"
        ? "record"
        : undefined;
  if (!key) return path;
  const ids = new URLSearchParams(match[2] ?? "").getAll(key);
  const id = ids.length === 1 && /^\d+$/.test(ids[0]) ? Number(ids[0]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? `${path}?${key}=${id}` : path;
}

/** 持久化目标仅包含开放页签的安全路由参数，账号隔离和权限过滤由工作区统一执行。 */
export function normalizeTabTargets(
  saved: unknown,
  paths: readonly string[],
): Record<string, string> {
  if (saved === null || typeof saved !== "object" || Array.isArray(saved))
    return {};
  const targets: Record<string, string> = {};
  for (const path of paths) {
    if (!Object.prototype.hasOwnProperty.call(saved, path)) continue;
    const target = adminRouteTarget((saved as Record<string, unknown>)[path]);
    if (target?.split("?")[0] === path && target !== path)
      targets[path] = target;
  }
  return targets;
}

/** 去重、权限过滤并固定首页。损坏的存储数据也只能恢复为合法页签。 */
export function normalizeTabs(
  saved: unknown,
  allowed: readonly string[],
  pinned: string,
): string[] {
  const paths = Array.isArray(saved) ? saved : [];
  return [
    ...new Set([
      pinned,
      ...paths.filter(
        (path): path is string =>
          typeof path === "string" && allowed.includes(path),
      ),
    ]),
  ];
}

export type CloseMode = "current" | "others" | "right" | "all";

/** 关闭活动页时优先选原位置右侧页，否则回退左侧；固定首页始终保留。 */
export function closeTabs(
  paths: string[],
  target: string,
  active: string,
  pinned: string,
  mode: CloseMode,
) {
  const index = paths.indexOf(target);
  const remaining = paths.filter(
    (path, i) =>
      path === pinned ||
      (mode === "current"
        ? path !== target
        : mode === "others"
          ? path === target
          : mode === "right"
            ? index < 0 || i <= index
            : false),
  );
  const activeIndex = paths.indexOf(active);
  const next = remaining.includes(active)
    ? active
    : (paths.slice(activeIndex + 1).find((path) => remaining.includes(path)) ??
      paths
        .slice(0, activeIndex)
        .reverse()
        .find((path) => remaining.includes(path)) ??
      pinned);
  return { paths: remaining, active: next };
}
