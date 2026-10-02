import { createContext, useContext } from "react";
import type { Appearance } from "./theme-model";

/** 独立上下文模块保持开发热更新时的身份稳定，避免编辑主题组件后 Provider 与消费者失配。 */
export const AppearanceContext = createContext<{
  appearance: Appearance;
  save: (value: Appearance) => boolean;
  /** 临时预览不写入存储；传入 null 恢复已保存偏好。 */
  preview: (value: Appearance | null) => void;
} | null>(null);

/** 后台主题消费者复用保存和临时预览边界，缺少 Provider 时明确失败而非使用错误默认主题。 */
export function useAdminAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("缺少主题上下文");
  return context;
}
