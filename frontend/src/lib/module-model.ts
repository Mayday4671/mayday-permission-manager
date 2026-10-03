/** 页面模块归属只控制展示；实际开关值由服务端计算，权限与数据范围始终在后端执行。 */
const pageModules: Record<string, string> = {
  "/admin/portal": "portal",
  "/admin/site-settings": "portal",
  "/admin/notices": "content",
  "/admin/categories": "content",
  "/admin/tags": "content",
  "/admin/recycle": "content",
  "/admin/notifications": "notifications",
  "/admin/messages": "notifications",
  "/admin/approval-categories": "approvals",
  "/admin/workflows": "approvals",
  "/admin/requests": "approvals",
  "/admin/tasks": "approvals",
  "/admin/crawler": "crawler",
  "/admin/crawler-config": "crawler",
  "/admin/udp-relay": "udp",
  "/admin/workorders": "workorders",
  "/admin/feedback": "feedback",
  "/admin/scheduler": "scheduler",
  // generator:frontend-modules
};

/** 将已登记页面映射到后端有效模块开关，设计器子路由统一归属审批模块。 */
export function pageEnabled(
  path: string,
  modules: Readonly<Record<string, boolean>>,
): boolean {
  const module =
    path === "/admin/workflows/designer" || path.startsWith("/admin/workflows/")
      ? "approvals"
      : pageModules[path];
  return !module || modules[module] === true;
}
