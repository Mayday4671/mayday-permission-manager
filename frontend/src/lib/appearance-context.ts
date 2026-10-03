import { createContext, useContext } from "react";
import type { Appearance } from "./theme-model";

/** 独立上下文模块保持开发热更新时的身份稳定，避免编辑主题组件后 Provider 与消费者失配。 */
export const AppearanceContext = createContext<{
  appearance: Appearance;
  save: (value: Appearance) => boolean;
  /** 临时预览不写入存储；传入 null 恢复已保存偏好。 */
  preview: (value: Appearance | null) => void;
} | null>(null);

/** 访客只能修改当前浏览器的明暗偏好；是否提供开关由门户后台控制。 */
export const PortalAppearanceContext = createContext<{
  dark: boolean;
  allowed: boolean;
  toggle: () => void;
} | null>(null);

/** 前台主题开关复用 Provider 的实际显示状态，系统模式也能准确切换。 */
export function usePortalAppearance() {
  const context = useContext(PortalAppearanceContext);
  if (!context) throw new Error("缺少门户主题上下文");
  return context;
}

/** 后台主题消费者复用保存和临时预览边界，缺少 Provider 时明确失败而非使用错误默认主题。 */
export function useAdminAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("缺少主题上下文");
  return context;
}
