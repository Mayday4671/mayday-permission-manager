/** 前后台共用的主题契约。只接受明确的设计选项，不执行来自数据库或本地存储的 CSS。 */
export interface Appearance {
  mode: "light" | "dark" | "system";
  primaryColor: string;
  borderRadius: number;
  compact: boolean;
  /** 导航外观独立于页面明暗；前台使用同一选项配置顶部导航。 */
  menuStyle: "light" | "dark" | "tinted";
  background: "neutral" | "slate" | "blue" | "warm";
  surfaceStyle: "border" | "shadow";
  contentWidth: "full" | "boxed";
  chartPalette: "brand" | "vivid" | "soft";
  successColor: string;
  warningColor: string;
  errorColor: string;
}
const SHARED_APPEARANCE = {
  menuStyle: "light",
  background: "neutral",
  surfaceStyle: "border",
  contentWidth: "full",
  chartPalette: "brand",
  successColor: "#52c41a",
  warningColor: "#faad14",
  errorColor: "#ff4d4f",
} as const;
export const ADMIN_APPEARANCE: Appearance = {
  ...SHARED_APPEARANCE,
  mode: "light",
  primaryColor: "#7955ce",
  borderRadius: 6,
  compact: false,
};
export const PORTAL_APPEARANCE: Appearance = {
  ...SHARED_APPEARANCE,
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

/** 预设仅改变外观，保留用户的明暗、宽度和密度选择。名称不进入持久化契约。 */
export const THEME_PRESETS = [
  {
    name: "经典蓝",
    primaryColor: "#1677ff",
    background: "neutral",
    menuStyle: "light",
    surfaceStyle: "border",
    borderRadius: 6,
    chartPalette: "brand",
  },
  {
    name: "青绿",
    primaryColor: "#08979c",
    background: "slate",
    menuStyle: "tinted",
    surfaceStyle: "border",
    borderRadius: 6,
    chartPalette: "soft",
  },
  {
    name: "商务",
    primaryColor: "#245da8",
    background: "slate",
    menuStyle: "dark",
    surfaceStyle: "border",
    borderRadius: 4,
    chartPalette: "brand",
  },
  {
    name: "暖橙",
    primaryColor: "#d46b08",
    background: "warm",
    menuStyle: "light",
    surfaceStyle: "shadow",
    borderRadius: 8,
    chartPalette: "vivid",
  },
  {
    name: "柔紫",
    primaryColor: "#7955ce",
    background: "blue",
    menuStyle: "tinted",
    surfaceStyle: "shadow",
    borderRadius: 8,
    chartPalette: "soft",
  },
] as const satisfies readonly ({ name: string } & Partial<Appearance>)[];

export const BACKGROUND_LABELS = {
  neutral: "中性灰",
  slate: "冷灰",
  blue: "浅蓝",
  warm: "暖灰",
} as const;
export const MENU_STYLE_LABELS = {
  light: "浅色",
  dark: "深色",
  tinted: "主题色",
} as const;
export const CHART_PALETTE_LABELS = {
  brand: "品牌色",
  vivid: "明快",
  soft: "柔和",
} as const;

/** 原始背景值固定在设计层；配置只保存枚举，避免执行来自存储的 CSS。 */
const BACKGROUNDS = {
  neutral: { light: "#f4f5f7", dark: "#141414" },
  slate: { light: "#f0f3f6", dark: "#131820" },
  blue: { light: "#eef3fb", dark: "#101827" },
  warm: { light: "#f6f3ee", dark: "#1d1915" },
};
/** 明暗外观只解析设计层的固定背景色板，用户配置不直接成为可执行 CSS 文本。 */
export function themeBackground(appearance: Appearance, dark: boolean) {
  return BACKGROUNDS[appearance.background][dark ? "dark" : "light"];
}

/** 多系列图表消费同一色板；品牌色模式的首色始终跟随当前主色。 */
export function chartColors(appearance: Appearance): readonly string[] {
  if (appearance.chartPalette === "vivid")
    return ["#1677ff", "#13a8a8", "#fa8c16", "#722ed1", "#eb2f96", "#52c41a"];
  if (appearance.chartPalette === "soft")
    return ["#6b8de3", "#51a6a1", "#d89a52", "#a17fc4", "#ce7897", "#86a95b"];
  return [
    appearance.primaryColor,
    "#13a8a8",
    "#fa8c16",
    "#722ed1",
    "#eb2f96",
    "#52c41a",
  ];
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const enumValue = <T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && options.includes(value as T)
    ? (value as T)
    : fallback;
const colorValue = (value: unknown, fallback: string) =>
  typeof value === "string" && COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback;

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
    primaryColor: colorValue(input.primaryColor, fallback.primaryColor),
    borderRadius:
      Number.isInteger(input.borderRadius) &&
      input.borderRadius! >= 0 &&
      input.borderRadius! <= 16
        ? input.borderRadius!
        : fallback.borderRadius,
    compact:
      typeof input.compact === "boolean" ? input.compact : fallback.compact,
    menuStyle: enumValue(
      input.menuStyle,
      ["light", "dark", "tinted"],
      fallback.menuStyle,
    ),
    background: enumValue(
      input.background,
      ["neutral", "slate", "blue", "warm"],
      fallback.background,
    ),
    surfaceStyle: enumValue(
      input.surfaceStyle,
      ["border", "shadow"],
      fallback.surfaceStyle,
    ),
    contentWidth: enumValue(
      input.contentWidth,
      ["full", "boxed"],
      fallback.contentWidth,
    ),
    chartPalette: enumValue(
      input.chartPalette,
      ["brand", "vivid", "soft"],
      fallback.chartPalette,
    ),
    successColor: colorValue(input.successColor, fallback.successColor),
    warningColor: colorValue(input.warningColor, fallback.warningColor),
    errorColor: colorValue(input.errorColor, fallback.errorColor),
  };
}

/** 导入采用严格白名单；旧四字段配置可升级，错误输入不会被静默替换后保存。 */
export function importAppearance(
  text: string,
  fallback: Appearance,
): Appearance {
  if (text.length > 2000) throw new Error("主题配置不能超过 2000 字符");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("请输入有效的主题 JSON 配置");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("主题配置必须是 JSON 对象");
  const record = value as Record<string, unknown>;
  const required = ["mode", "primaryColor", "borderRadius", "compact"];
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !Object.hasOwn(ADMIN_APPEARANCE, key))
  )
    throw new Error("主题配置缺少必填字段或含有不支持的字段");
  const normalized = normalizeAppearance(record, fallback);
  if (
    Object.entries(record).some(([key, value]) =>
      typeof value === "string" && key.endsWith("Color")
        ? !COLOR_PATTERN.test(value)
        : value !== normalized[key as keyof Appearance],
    )
  )
    throw new Error("主题配置含有无效的颜色、枚举、圆角或开关");
  return normalized;
}
