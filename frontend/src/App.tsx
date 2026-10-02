import {
  Component,
  Suspense,
  lazy,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Button, Result, Spin } from "antd";
import { useAuth } from "./lib/auth";
import { AdminLayout } from "./layouts/AdminLayout";
import { LoginPage } from "./pages/LoginPage";
import { PortalPage, ArticlePage } from "./pages/PortalPage";
import { adminPages } from "./lib/workspace-model";
import { useModules } from "./lib/modules";
import { pageEnabled } from "./lib/module-model";
import "./workflow.css";
import "./components/table-tools.css";

/** 按页面拆分代码，门户访客不下载后台图表及权限编辑器。 */
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const UdpRelayPage = lazy(() =>
  import("./pages/operations/UdpRelayPage").then((m) => ({
    default: m.UdpRelayPage,
  })),
);
const CrawlDataPage = lazy(() =>
  import("./pages/operations/CrawlDataPage").then((m) => ({
    default: m.CrawlDataPage,
  })),
);
const CrawlConfigPage = lazy(() =>
  import("./pages/operations/CrawlConfigPage").then((m) => ({
    default: m.CrawlConfigPage,
  })),
);
const UsersPage = lazy(() =>
  import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const RolesPage = lazy(() =>
  import("./pages/RolesPage").then((m) => ({ default: m.RolesPage })),
);
const EntriesPage = lazy(() =>
  import("./pages/EntriesPage").then((m) => ({ default: m.EntriesPage })),
);
const DictionariesPage = lazy(() =>
  import("./pages/DictionariesPage").then((m) => ({
    default: m.DictionariesPage,
  })),
);
const LoginLogsPage = lazy(() =>
  import("./pages/LogsPage").then((m) => ({ default: m.LoginLogsPage })),
);
const UserStatisticsPage = lazy(() =>
  import("./pages/UserStatisticsPage").then((m) => ({
    default: m.UserStatisticsPage,
  })),
);
const SiteSettingsPage = lazy(() =>
  import("./pages/SiteSettingsPage").then((m) => ({
    default: m.SiteSettingsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/operations/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const MessagesPage = lazy(() =>
  import("./pages/operations/MessagesPage").then((m) => ({
    default: m.MessagesPage,
  })),
);
const FilesPage = lazy(() =>
  import("./pages/operations/FilesPage").then((m) => ({
    default: m.FilesPage,
  })),
);
const NoticesPage = lazy(() =>
  import("./pages/NoticesPage").then((m) => ({ default: m.NoticesPage })),
);
const RecyclePage = lazy(() =>
  import("./pages/NoticesPage").then((m) => ({ default: m.RecyclePage })),
);
const LogsPage = lazy(() =>
  import("./pages/LogsPage").then((m) => ({ default: m.LogsPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const WorkflowsPage = lazy(() =>
  import("./pages/operations/WorkflowsPage").then((m) => ({
    default: m.WorkflowsPage,
  })),
);
const WorkflowDesignerPage = lazy(() =>
  import("./pages/operations/WorkflowDesignerPage").then((m) => ({
    default: m.WorkflowDesignerPage,
  })),
);
const RequestsPage = lazy(() =>
  import("./pages/operations/RequestsPage").then((m) => ({
    default: m.RequestsPage,
  })),
);
const ApprovalTasksPage = lazy(() =>
  import("./pages/operations/RequestsPage").then((m) => ({
    default: m.ApprovalTasksPage,
  })),
);

const WorkOrderPage = lazy(() =>
  import("./pages/business/WorkOrderPage").then((module) => ({
    default: module.WorkOrderPage,
  })),
);
// generator:frontend-imports
const FeedbackPage = lazy(() =>
  import("./pages/operations/FeedbackPage").then((module) => ({
    default: module.FeedbackPage,
  })),
);
const SchedulerPage = lazy(() =>
  import("./pages/operations/SchedulerPage").then((module) => ({
    default: module.SchedulerPage,
  })),
);
const MonitorPage = lazy(() =>
  import("./pages/operations/MonitorPage").then((module) => ({
    default: module.MonitorPage,
  })),
);
const SessionsPage = lazy(() =>
  import("./pages/operations/SystemPages").then((module) => ({
    default: module.SessionsPage,
  })),
);
const ChangesPage = lazy(() =>
  import("./pages/ChangesPage").then((module) => ({
    default: module.ChangesPage,
  })),
);

function Protected() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="full-loading">
        <Spin size="large" />
      </div>
    );
  return session ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname }} />
  );
}
function Guard({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? (
    children
  ) : (
    <Result
      status="403"
      title="无权访问此页面"
      subTitle="如需访问，请联系管理员调整你的角色权限。"
      extra={<Button href="/admin/profile">前往个人中心</Button>}
    />
  );
}
function DashboardRoute() {
  const { can } = useAuth();
  return can("dashboard:view") ? (
    <DashboardPage />
  ) : (
    <Navigate to="/admin/profile" replace />
  );
}
/** 渲染异常保留恢复入口，不把内部错误或堆栈展示给终端用户。 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面异常", error.message, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <Result
        status="500"
        title="页面加载失败"
        extra={
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}
/** 应用路由总入口：门户使用后台独立主题配置，后台路由同时等待会话和模块状态；权限隐藏不能替代服务器校验。 */
export default function Application() {
  const location = useLocation();
  const modules = useModules();
  // 从列表进入详情时回到页面顶部；保留门户自身的锚点滚动行为。
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return (
    <Suspense
      fallback={
        <div className="full-loading">
          <Spin />
        </div>
      }
    >
      <Routes>
        <Route
          path="/"
          element={
            modules.portal ? <PortalPage /> : <Navigate to="/login" replace />
          }
        />
        {modules.portal && (
          <Route path="/categories/:categoryId" element={<PortalPage />} />
        )}
        {modules.portal && (
          <Route path="/articles/:id" element={<ArticlePage />} />
        )}
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected />}>
          <Route path="/admin" element={<AdminLayout />}>
            {adminPages.map((page) => {
              if (page.path === "/admin")
                return (
                  <Route key={page.path} index element={<DashboardRoute />} />
                );
              const screens = {
                feedback: FeedbackPage,
                scheduler: SchedulerPage,
                monitor: MonitorPage,
                sessions: SessionsPage,
                changes: ChangesPage,
                workorders: WorkOrderPage,
                // generator:frontend-screens
                workflows: WorkflowsPage,
                workflowDesigner: WorkflowDesignerPage,
                requests: RequestsPage,
                approvalTasks: ApprovalTasksPage,
                users: UsersPage,
                roles: RolesPage,
                dictionaries: DictionariesPage,
                loginlogs: LoginLogsPage,
                userstats: UserStatisticsPage,
                site: SiteSettingsPage,
                settings: SettingsPage,
                notifications: NotificationsPage,
                messages: MessagesPage,
                files: FilesPage,
                notices: NoticesPage,
                recycle: RecyclePage,
                logs: LogsPage,
                profile: ProfilePage,
                dashboard: DashboardPage,
                crawlerData: CrawlDataPage,
                crawlerConfig: CrawlConfigPage,
                udpRelay: UdpRelayPage,
              };
              const Screen =
                page.screen === "entries" ? null : screens[page.screen];
              const content =
                page.screen === "entries" ? (
                  <EntriesPage kind={page.kind} />
                ) : Screen ? (
                  <Screen />
                ) : null;
              return (
                <Route
                  key={page.path}
                  path={page.path.slice("/admin/".length)}
                  element={
                    !pageEnabled(page.path, modules) ? (
                      <Result status="404" title="该功能未启用" />
                    ) : page.permission ? (
                      <Guard permission={page.permission}>{content}</Guard>
                    ) : (
                      content
                    )
                  }
                />
              );
            })}
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <Result
              status="404"
              title="页面不存在"
              extra={<Button href="/">返回首页</Button>}
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
