export interface LeaveGuard {
  active: () => boolean;
  confirm: () => Promise<boolean>;
}

/** 多个弹窗和流程编辑可同时存在；统一汇总到一个路由拦截器，避免相互覆盖。 */
export function createLeaveGuards() {
  const guards = new Map<symbol, LeaveGuard>();
  let pending: Promise<boolean> | null = null;
  return {
    register(guard: LeaveGuard) {
      const key = Symbol();
      guards.set(key, guard);
      return () => {
        guards.delete(key);
      };
    },
    active: () => [...guards.values()].some((guard) => guard.active()),
    confirm(): Promise<boolean> {
      if (pending) return pending;
      pending = (async () => {
        // 后打开的弹窗先确认；任一取消即保留完整工作区，不清理其他页面状态。
        for (const guard of [...guards.values()].reverse()) {
          if (guard.active() && !(await guard.confirm())) return false;
        }
        return true;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
