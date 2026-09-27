import { useCallback, useEffect, useRef } from "react";
import { App } from "antd";
import { useOptionalWorkspace } from "./workspace";

/** 弹窗、个人资料和流程设计共用修改保护；只登记布尔状态，不缓存任何表单内容。 */
export function useUnsavedChanges(
  dirty: boolean,
  options: { title?: string; busy?: boolean; zIndex?: number } = {},
) {
  const { modal, message } = App.useApp();
  const workspace = useOptionalWorkspace();
  const register = workspace?.registerLeaveGuard;
  const latest = useRef({ dirty, ...options });
  latest.current = { dirty, ...options };
  const pending = useRef<Promise<boolean> | null>(null);
  const confirmLeave = useCallback((): Promise<boolean> => {
    if (latest.current.busy) {
      message.info("正在保存，请稍候再离开");
      return Promise.resolve(false);
    }
    if (!latest.current.dirty) return Promise.resolve(true);
    if (pending.current) return pending.current;
    pending.current = new Promise<boolean>((resolve) => {
      modal.confirm({
        title: latest.current.title ?? "放弃未保存的修改？",
        content: "离开或刷新后，本次修改不会保存。",
        centered: true,
        zIndex: latest.current.zIndex,
        okText: "放弃修改",
        cancelText: "继续编辑",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    }).finally(() => {
      pending.current = null;
    });
    return pending.current;
  }, [modal, message]);
  useEffect(
    () =>
      register?.({
        active: () => latest.current.dirty || Boolean(latest.current.busy),
        confirm: confirmLeave,
      }),
    [register, confirmLeave],
  );
  // 工作区外的共享弹窗至少防止浏览器刷新丢失修改；后台只有一个 beforeunload 监听器。
  useEffect(() => {
    if (register) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty || latest.current.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [register]);
  return confirmLeave;
}
