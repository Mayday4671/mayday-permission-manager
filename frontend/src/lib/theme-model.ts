/** 前后台共用的主题契约。只接受明确的设计选项，不执行来自数据库或本地存储的 CSS。 */
export interface Appearance {
  mode: "light" | "dark" | "system";
  primaryColor: string;
  borderRadius: number;
  compact: boolean;
}
export const ADMIN_APPEARANCE: Appearance = {
  mode: "light",
  primaryColor: "#7955ce",
  borderRadius: 6,
  compact: false,
};
export const PORTAL_APPEARANCE: Appearance = {
  mode: "light",
  primaryColor: "#245da8",
  borderRadius: 4,
  compact: false,
};
export const THEME_COLORS = [
  { name: "蓝色", value: "#1677ff" },
  { name: "深蓝", value: "#245da8" },
  { name: "紫色", value: "#7955ce" },
  { name: "青色", value: "#08979c" },
  { name: "绿色", value: "#389e0d" },
  { name: "橙色", value: "#d46b08" },
  { name: "玫红", value: "#c41d7f" },
];
/** 缺字段和旧版本配置逐项回退；损坏的本地存储或异常公开配置不会使整个站点白屏。 */
export function normalizeAppearance(
  value: unknown,
  fallback: Appearance,
): Appearance {
  const input =
    value && typeof value === "object" ? (value as Partial<Appearance>) : {};
  return {
    mode: ["light", "dark", "system"].includes(input.mode ?? "")
      ? input.mode!
      : fallback.mode,
    primaryColor:
      typeof input.primaryColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(input.primaryColor)
        ? input.primaryColor.toLowerCase()
        : fallback.primaryColor,
    borderRadius:
      Number.isInteger(input.borderRadius) &&
      input.borderRadius! >= 0 &&
      input.borderRadius! <= 16
        ? input.borderRadius!
        : fallback.borderRadius,
    compact:
      typeof input.compact === "boolean" ? input.compact : fallback.compact,
  };
}
