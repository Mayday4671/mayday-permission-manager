import { Suspense, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  App,
  Badge,
  Button,
  Dropdown,
  Input,
  Modal,
  Spin,
  Tooltip,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Globe,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useModules } from "../lib/modules";
import { pageEnabled } from "../lib/module-model";
import { useUnreadCount } from "../lib/personal-work";
import { Brand, PersonAvatar } from "../components/shared";
import { WorkspaceTabs, workspaceTabId } from "../components/WorkspaceTabs";
import { WorkspaceProvider, useWorkspace } from "../lib/workspace";
import { adminPages } from "../lib/workspace-model";
import { AdminNavigation } from "../components/AdminNavigation";
import { AdminThemeButton } from "../components/ThemeEditor";
import type { Entry } from "../types";

/** 后台壳层：后端返回可访问导航；移动端使用可关闭的遮罩导航，全局搜索只检索当前有权访问的页面。 */
export function AdminLayout() {
  const { session } = useAuth();
  // 账号切换时重建整个页签上下文，避免复用上一账号的页面状态。
  return (
    <WorkspaceProvider key={session!.user.id}>
      <AdminShell />
    </WorkspaceProvider>
  );
}

function AdminShell() {
  const modules = useModules();
  const { session, logout, can } = useAuth();
  const { revision, active, confirmLeave } = useWorkspace();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const compact = collapsed && !narrow;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const changed = () => {
      setNarrow(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  // 窄屏导航开启时锁定背景滚动并圈定键盘焦点，Escape 关闭后回到触发按钮。
  useEffect(() => {
    if (!mobile || !narrow) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled])",
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobile(false);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      menuButtonRef.current?.focus();
    };
  }, [mobile, narrow]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [help, setHelp] = useState(false);
  const navigation = useQuery({
    queryKey: ["navigation", session?.permissions],
    queryFn: () => api<Entry[]>("/system/navigation"),
  });
  const unread = useUnreadCount();
  // 配置决定顺序与显示名称，页面登记决定可实现的路由和真实权限；未知路由不进入搜索或菜单。
  const items = (navigation.data ?? []).filter((item) =>
    adminPages.some(
      (page) =>
        page.path === item.path &&
        page.permission === item.permission &&
        pageEnabled(page.path, modules),
    ),
  );
  const current = items.find((item) => item.path === location.pathname);
  const currentTitle =
    current?.name ??
    adminPages.find((page) => page.path === active)?.title ??
    "页面不存在";
  useEffect(() => {
    setMobile(false);
    document.title = `${currentTitle} · Mayday`;
  }, [location.pathname, currentTitle]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const doLogout = async () => {
    if (!(await confirmLeave())) return;
    try {
      await logout();
    } catch {
      message.warning("本地会话已退出");
    }
    navigate("/login");
  };
  return (
    <div className={`admin-layout ${compact ? "sidebar-collapsed" : ""}`}>
      {mobile && (
        <div className="sidebar-backdrop" onClick={() => setMobile(false)} />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobile ? "mobile-open" : ""}`}
        aria-label="主导航"
        inert={narrow && !mobile}
      >
        {narrow && mobile && (
          <Button
            type="text"
            className="mobile-nav-close"
            aria-label="关闭导航"
            icon={<X size={18} />}
            onClick={() => setMobile(false)}
          />
        )}
        <Link className="brand-link" to="/admin" aria-label="Mayday 工作台">
          <Brand />
        </Link>
        <nav className="side-navigation">
          <AdminNavigation items={items} compact={compact} />
          {navigation.isError && (
            <Button onClick={() => void navigation.refetch()}>
              重新加载菜单
            </Button>
          )}
        </nav>
        <div className="sidebar-bottom">
          {modules.portal && (
            <Link to="/" className="portal-shortcut">
              <span className="portal-icon">
                <Globe size={20} />
              </span>
              <span>
                <b>前台门户</b>
              </span>
              <ArrowUpRight size={17} />
            </Link>
          )}
          <button
            className="help-link"
            onClick={() => {
              setMobile(false);
              setHelp(true);
            }}
          >
            <CircleHelp size={18} />
            <span>帮助与使用指南</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-version">
            <span className="status-dot" />
            Mayday v1.0
          </div>
        </div>
      </aside>
      <div className="admin-main" inert={narrow && mobile}>
        <header className="topbar">
          <div className="topbar-left">
            <Button
              type="text"
              className="desktop-collapse"
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
              aria-expanded={!collapsed}
              icon={
                collapsed ? (
                  <PanelLeftOpen size={19} />
                ) : (
                  <PanelLeftClose size={19} />
                )
              }
              onClick={() => setCollapsed(!collapsed)}
            />
            <Button
              type="text"
              className="mobile-menu"
              ref={menuButtonRef}
              aria-expanded={mobile}
              aria-label="打开导航"
              icon={<Menu size={20} />}
              onClick={() => setMobile(true)}
            />
            <div className="breadcrumb">
              <span>后台管理</span>
              <ChevronRight size={14} />
              <b>{currentTitle}</b>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>搜索页面...</span>
              <kbd>
                <Command size={11} /> K
              </kbd>
            </button>
            <AdminThemeButton />
            <Tooltip title="打开前台门户">
              <Link className="icon-link" to="/" aria-label="打开前台门户">
                <Globe size={19} />
              </Link>
            </Tooltip>
            {can("messages:view") && (
              <Badge
                count={unread.isError ? 0 : (unread.data ?? 0)}
                size="small"
                offset={[-5, 5]}
              >
                <Button
                  type="text"
                  aria-label={
                    unread.isError
                      ? "收件箱（未读数加载失败）"
                      : `个人收件箱${unread.data ? `，${unread.data} 条未读` : ""}`
                  }
                  icon={<Bell size={19} />}
                  onClick={() => navigate("/admin/messages")}
                />
              </Badge>
            )}
            <span className="topbar-divider" />
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "profile",
                    label: "个人中心",
                    icon: <Settings2 size={15} />,
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    label: "退出登录",
                    icon: <LogOut size={15} />,
                    danger: true,
                  },
                ],
                onClick: ({ key }) =>
                  key === "logout"
                    ? void doLogout()
                    : navigate("/admin/profile"),
              }}
            >
              <button className="user-dropdown">
                <PersonAvatar name={session?.user.nickname ?? "M"} size={34} />
                <div>
                  <b>{session?.user.nickname}</b>
                </div>
                <ChevronDown size={14} />
              </button>
            </Dropdown>
          </div>
        </header>
        <WorkspaceTabs
          titles={Object.fromEntries(
            items.map((item) => [item.path, item.name]),
          )}
        />
        <main className="page-content">
          <div
            role="tabpanel"
            id="workspace-page"
            aria-labelledby={workspaceTabId(active)}
          >
            <Suspense
              fallback={
                <div className="page-loading">
                  <Spin />
                </div>
              }
            >
              <Outlet key={`${active}:${revision}`} />
            </Suspense>
          </div>
        </main>
        <footer className="admin-footer">
          <span>© {new Date().getFullYear()} Mayday</span>
          <span>
            <span className="status-dot" />
            {navigation.isError
              ? "连接异常，请重试"
              : navigation.isFetching
                ? "正在同步数据"
                : "服务已连接"}
          </span>
        </footer>
      </div>
      <Modal
        title="快速前往"
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        closeIcon={<X size={18} />}
      >
        <Input
          autoFocus
          size="large"
          prefix={<Search size={18} />}
          placeholder="输入页面名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="search-results">
          {items
            .filter((i) => i.name.includes(keyword))
            .map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.path);
                  setSearchOpen(false);
                  setKeyword("");
                }}
              >
                <span>{item.name}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          {items.filter((i) => i.name.includes(keyword)).length === 0 && (
            <p>没有匹配的页面</p>
          )}
        </div>
      </Modal>
      <Modal
        title="使用指南"
        open={help}
        onCancel={() => setHelp(false)}
        footer={
          <Button type="primary" onClick={() => setHelp(false)}>
            关闭
          </Button>
        }
      >
        <div className="help-content">
          <h4>用户与部门</h4>
          <p>先设置组织部门，再创建成员并分配角色。</p>
          <h4>角色权限</h4>
          <p>
            在角色权限中，分别选择操作权限与数据范围。敏感字段、导出和内容发布需要独立授权。
          </p>
          <h4>内容发布</h4>
          <p>内容中心支持草稿和发布。已发布的内容会出现在前台门户中。</p>
          <h4>多页签</h4>
          <p>
            点击菜单打开页签。右键页签可刷新、关闭其他或右侧页签。切换页签保留列表的筛选条件与分页；关闭页签后重置这些条件。
          </p>
        </div>
      </Modal>
    </div>
  );
}
