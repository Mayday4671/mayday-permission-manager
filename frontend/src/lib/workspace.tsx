import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import { createLeaveGuards, type LeaveGuard } from "./leave-guards";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { useModules } from "./modules";
import { pageEnabled } from "./module-model";
import {
  adminPages,
  closeTabs,
  normalizeTabs,
  type CloseMode,
} from "./workspace-model";

type PageCache = Map<string, Map<string, unknown>>;
interface WorkspaceValue {
  paths: string[];
  active: string;
  pinned: string;
  revision: number;
  cache: PageCache;
  close: (target: string, mode: CloseMode) => void;
  refresh: (path: string) => void;
  registerLeaveGuard: (guard: LeaveGuard) => () => void;
  confirmLeave: () => Promise<boolean>;
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * 页签壳层只保存路由清单和非敏感的列表筛选状态，表单和密码不进入缓存。
 * 路由清单按账号隔离并保存在 sessionStorage；筛选状态仅保留于本次后台挂载期间。
 * 页面仍通过原有路由 Guard 检查权限，页签可见性不替代接口及路由授权。
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const modules = useModules();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const active = location.pathname.replace(/\/$/, "");
  const allowed = useMemo(
    () =>
      adminPages
        .filter(
          (page) =>
            pageEnabled(page.path, modules) &&
            (page.permission === null ||
              session?.permissions.includes(page.permission)),
        )
        .map((page) => page.path),
    [session?.permissions, modules],
  );
  const pinned = allowed.includes("/admin") ? "/admin" : "/admin/profile";
  const storageKey = `mayday.workspace.tabs.${session!.user.id}`;
  const [paths, setPaths] = useState<string[]>(() => {
    let saved: unknown;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    } catch {
      /* 无存储权限时仍可使用内存页签。 */
    }
    const initial = normalizeTabs(saved, allowed, pinned);
    return allowed.includes(active as (typeof allowed)[number]) &&
      !initial.includes(active)
      ? [...initial, active]
      : initial;
  });
  const [versions, setVersions] = useState<Record<string, number>>({});
  const cache = useRef<PageCache>(new Map()).current;
  const guards = useRef(createLeaveGuards()).current;
  const registerLeaveGuard = useCallback(
    (guard: LeaveGuard) => guards.register(guard),
    [guards],
  );
  const confirmLeave = useCallback(() => guards.confirm(), [guards]);
  // 页签关闭已确认过修改，紧随其后的导航不能再次弹出相同问题。
  const skipNextRoute = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (skipNextRoute.current) {
      skipNextRoute.current = false;
      return false;
    }
    return (
      guards.active() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search)
    );
  });
  const handling = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || handling.current) return;
    handling.current = true;
    void confirmLeave()
      .then((allowed) => {
        if (allowed) blocker.proceed();
        else blocker.reset();
      })
      .finally(() => {
        handling.current = false;
      });
  }, [blocker, confirmLeave]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (guards.active()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guards]);

  useEffect(() => {
    setPaths((previous) => {
      const next = normalizeTabs(previous, allowed, pinned);
      if (
        allowed.includes(active as (typeof allowed)[number]) &&
        !next.includes(active)
      )
        next.push(active);
      return next.join("|") === previous.join("|") ? previous : next;
    });
    // 权限撤回后立即销毁对应查询条件；当前路由交由 Guard 展示 403。
    for (const path of cache.keys())
      if (!allowed.includes(path as (typeof allowed)[number]))
        cache.delete(path);
  }, [active, allowed, pinned, cache]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(paths));
    } catch {
      /* 浏览器禁用存储不影响导航。 */
    }
  }, [paths, storageKey]);

  const close = async (target: string, mode: CloseMode) => {
    const result = closeTabs(paths, target, active, pinned, mode);
    // 必须先征询当前编辑页，再修改页签和缓存；取消时页面与页签保持完整。
    if (!result.paths.includes(active) && !(await confirmLeave())) return;
    for (const path of paths)
      if (!result.paths.includes(path)) cache.delete(path);
    setPaths(result.paths);
    if (result.active !== active) {
      skipNextRoute.current = true;
      navigate(result.active);
    }
  };
  const refresh = async (path: string) => {
    if (!(await confirmLeave())) return;
    // 失效已有数据并重新挂载活动页面；筛选缓存保留，未提交的表单不保留。
    void client.invalidateQueries();
    setVersions((previous) => ({
      ...previous,
      [path]: (previous[path] ?? 0) + 1,
    }));
    if (path !== active) {
      skipNextRoute.current = true;
      navigate(path);
    }
  };
  return (
    <WorkspaceContext.Provider
      value={{
        paths,
        active,
        pinned,
        revision: versions[active] ?? 0,
        cache,
        close,
        refresh,
        registerLeaveGuard,
        confirmLeave,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

/** 后台页签消费者共享关闭、刷新和离开保护上下文，表单与密码不能进入页签筛选缓存。 */
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider 未挂载");
  return value;
}

/** 共享弹窗也能在没有后台工作区的页面复用，仍保留本地关闭提醒。 */
export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}

/** 通用列表通过此钩子保留输入词、已提交条件及分页；关闭页签即丢弃，重新打开使用默认值。 */
export function usePageState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const { cache, active } = useWorkspace();
  const [value, setValue] = useState<T>(() =>
    cache.get(active)?.has(key) ? (cache.get(active)!.get(key) as T) : initial,
  );
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((previous) => {
        const resolved =
          typeof next === "function"
            ? (next as (value: T) => T)(previous)
            : next;
        const page = cache.get(active) ?? new Map<string, unknown>();
        page.set(key, resolved);
        cache.set(active, page);
        return resolved;
      });
    },
    [cache, active, key],
  );
  return [value, update];
}
