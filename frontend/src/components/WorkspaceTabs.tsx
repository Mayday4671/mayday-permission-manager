import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { ChevronDown, List, RefreshCw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { adminPages, type CloseMode } from "../lib/workspace-model";
import { useWorkspace } from "../lib/workspace";

// 溢出菜单挂载到稳定的节点，避免移动端切换窗口宽度时容器随页签导航重建。
const popupContainer = () => document.body;

/** 共用多页签栏：路由即标识。原生横向滚动承载任意宽度，菜单承载批量操作。 */
export function WorkspaceTabs({ titles }: { titles: Record<string, string> }) {
  const workspace = useWorkspace();
  const { paths, active, pinned, close, refresh, destinationOf } = workspace;
  const navigate = useNavigate();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    // 仅移动页签栏的横轴；scrollIntoView 会连带滚动整页，造成长页面切换时跳动。
    const tab = buttons.current.get(active)?.parentElement;
    const list = tab?.closest<HTMLElement>(".workspace-tab-list");
    if (!tab || !list) return;
    const reveal = () => {
      const item = tab.getBoundingClientRect(),
        viewport = list.getBoundingClientRect();
      if (item.left < viewport.left)
        list.scrollLeft -= viewport.left - item.left;
      else if (item.right > viewport.right)
        list.scrollLeft += item.right - viewport.right;
    };
    reveal();
    // 侧栏折叠或窗口变窄也会改变可视范围，当前页签仍应保持可见。
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, paths]);
  const titleOf = (path: string) =>
    titles[path] ??
    adminPages.find((page) => page.path === path)?.title ??
    path;
  // 遵循页签键盘约定：方向键切换，Home/End 跳到首尾，Delete 关闭当前非固定页。
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, path: string) => {
    const index = paths.indexOf(path);
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % paths.length
        : event.key === "ArrowLeft"
          ? (index - 1 + paths.length) % paths.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? paths.length - 1
              : -1;
    if (nextIndex >= 0) {
      event.preventDefault();
      navigate(destinationOf(paths[nextIndex]));
      buttons.current.get(paths[nextIndex])?.focus({ preventScroll: true });
    } else if (event.key === "Delete" && path !== pinned) {
      event.preventDefault();
      close(path, "current");
    }
  };
  const menu = (target: string): MenuProps => ({
    items: [
      { key: "refresh", label: "刷新此页", icon: <RefreshCw size={14} /> },
      { type: "divider" },
      { key: "current", label: "关闭此页", disabled: target === pinned },
      {
        key: "others",
        label: "关闭其他页签",
        disabled: !paths.some((path) => path !== pinned && path !== target),
      },
      {
        key: "right",
        label: "关闭右侧页签",
        disabled: paths.indexOf(target) === paths.length - 1,
      },
      { key: "all", label: "关闭全部页签", disabled: paths.length === 1 },
    ],
    onClick: ({ key }) =>
      key === "refresh" ? refresh(target) : close(target, key as CloseMode),
  });
  return (
    <nav className="workspace-tabs" aria-label="已打开的页面">
      <div className="workspace-tab-list" role="tablist" aria-label="页面标签">
        {paths.map((path) => (
          <Dropdown
            key={path}
            trigger={["contextMenu"]}
            menu={menu(path)}
            getPopupContainer={popupContainer}
          >
            <div
              className={`workspace-tab ${path === active ? "is-active" : ""}`}
              onAuxClick={(event) => {
                if (event.button === 1 && path !== pinned) {
                  event.preventDefault();
                  close(path, "current");
                }
              }}
            >
              <button
                type="button"
                role="tab"
                id={workspaceTabId(path)}
                aria-controls="workspace-page"
                aria-selected={path === active}
                tabIndex={path === active ? 0 : -1}
                ref={(node) => {
                  if (node) buttons.current.set(path, node);
                  else buttons.current.delete(path);
                }}
                onClick={() => navigate(destinationOf(path))}
                onKeyDown={(event) => onKeyDown(event, path)}
              >
                {titleOf(path)}
              </button>
              {path !== pinned && (
                <button
                  type="button"
                  className="workspace-tab-close"
                  aria-label={`关闭${titleOf(path)}`}
                  onClick={() => close(path, "current")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </Dropdown>
        ))}
      </div>
      <div className="workspace-tab-tools">
        <Dropdown
          trigger={["click"]}
          getPopupContainer={popupContainer}
          menu={{
            items: paths.map((path) => ({ key: path, label: titleOf(path) })),
            selectedKeys: [active],
            onClick: ({ key }) => navigate(destinationOf(key)),
          }}
        >
          <Button type="text" aria-label="所有页签" icon={<List size={16} />} />
        </Dropdown>
        <Tooltip title="刷新当前页">
          <Button
            type="text"
            aria-label="刷新当前页"
            icon={<RefreshCw size={15} />}
            onClick={() => refresh(active)}
          />
        </Tooltip>
        <Dropdown
          trigger={["click"]}
          menu={menu(active)}
          getPopupContainer={popupContainer}
        >
          <Button
            type="text"
            aria-label="页签操作"
            icon={<ChevronDown size={16} />}
          />
        </Dropdown>
      </div>
    </nav>
  );
}

/** 页签与实际路由内容通过 ARIA 关联，便于键盘与读屏用户定位。 */
export const workspaceTabId = (path: string) =>
  `workspace-tab-${path.replaceAll("/", "-")}`;
