import { useEffect, useState } from "react";
import { Dropdown } from "antd";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  FileText,
  FolderTree,
  LayoutDashboard,
  Menu,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { adminPages } from "../lib/workspace-model";
import type { Entry } from "../types";

const groups = [
  { name: "工作空间", icon: Users },
  { name: "内容管理", icon: FileText },
  { name: "通知中心", icon: Bell },
  { name: "审批中心", icon: ClipboardCheck },
  { name: "系统管理", icon: Settings2 },
];
const icons: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  users: Users,
  roles: ShieldCheck,
  departments: FolderTree,
  menus: Menu,
  notices: FileText,
  dictionaries: BookOpen,
  settings: SlidersHorizontal,
  logs: Activity,
};

/**
 * 单侧分组导航：只展开一个分组，避免首次进入就展示全部菜单。
 * 分组仅整理服务端已授权的入口，不产生新的权限来源；路由切换时自动定位所属分组。
 * 缩窄侧栏显示分组快捷菜单，避免把二十多个图标重新堆成另一条长列表。
 */
export function AdminNavigation({
  items,
  compact,
}: {
  items: Entry[];
  compact: boolean;
}) {
  const { pathname } = useLocation();
  const currentGroup = adminPages.find((page) => page.path === pathname)?.group;
  const [expanded, setExpanded] = useState<string | null>(currentGroup ?? null);
  useEffect(() => {
    setExpanded(currentGroup ?? null);
  }, [pathname, currentGroup]);
  const itemIcon = (item: Entry) =>
    icons[item.icon ?? ""] ??
    icons[adminPages.find((page) => page.path === item.path)?.icon ?? ""] ??
    FileText;
  const renderItem = (item: Entry) => {
    const Icon = itemIcon(item);
    return (
      <NavLink
        key={item.id}
        to={item.path}
        end
        className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        title={compact ? item.name : undefined}
        aria-label={item.name}
      >
        <Icon size={18} />
        <span>{item.name}</span>
      </NavLink>
    );
  };
  return (
    <>
      {items.filter((item) => item.path === "/admin").map(renderItem)}
      {items
        .filter(
          (item) =>
            adminPages.find((page) => page.path === item.path)?.group ===
            "独立入口",
        )
        .map(renderItem)}
      {groups.map(({ name, icon: Icon }, index) => {
        const children = items.filter(
          (item) =>
            adminPages.find((page) => page.path === item.path)?.group === name,
        );
        if (!children.length) return null;
        const isCurrent = currentGroup === name;
        if (compact)
          return (
            <Dropdown
              key={name}
              trigger={["click"]}
              placement="rightTop"
              menu={{
                selectedKeys: [pathname],
                items: children.map((item) => {
                  const ChildIcon = itemIcon(item);
                  return {
                    key: item.path,
                    icon: <ChildIcon size={16} />,
                    label: <Link to={item.path}>{item.name}</Link>,
                  };
                }),
              }}
            >
              <button
                type="button"
                className={`nav-group-trigger compact ${isCurrent ? "is-current" : ""}`}
                aria-label={name}
                aria-haspopup="menu"
                title={name}
              >
                <Icon size={19} />
              </button>
            </Dropdown>
          );
        const isOpen = expanded === name;
        return (
          <section className="nav-group" key={name}>
            <button
              type="button"
              className={`nav-group-trigger ${isCurrent ? "is-current" : ""}`}
              aria-expanded={isOpen}
              aria-controls={`navigation-group-${index}`}
              onClick={() => setExpanded(isOpen ? null : name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              <ChevronDown size={15} className={isOpen ? "is-open" : ""} />
            </button>
            <div
              id={`navigation-group-${index}`}
              className="nav-group-items"
              hidden={!isOpen}
            >
              {children.map(renderItem)}
            </div>
          </section>
        );
      })}
    </>
  );
}
