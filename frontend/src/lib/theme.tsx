import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { App, ConfigProvider, theme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useLocation } from "react-router-dom";
import { useSite } from "./portal";
import { AppearanceContext } from "./appearance-context";
import {
  ADMIN_APPEARANCE,
  PORTAL_APPEARANCE,
  normalizeAppearance,
  chartColors,
  themeBackground,
  type Appearance,
} from "./theme-model";

const STORAGE_KEY = "mayday.admin.appearance.v1";
function readPreference() {
  try {
    return normalizeAppearance(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
      ADMIN_APPEARANCE,
    );
  } catch {
    return { ...ADMIN_APPEARANCE };
  }
}
/** 监听系统明暗变化；只有选择“跟随系统”的主题使用此值，手动选择不会被覆盖。 */
function useSystemDark() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return dark;
}

/** Ant 算法负责调色和密度派生，业务样式只消费结果；前台与后台不互相继承主题。 */
export function ThemeScope({
  appearance,
  portal = false,
  documentScope = false,
  children,
}: {
  appearance: Appearance;
  portal?: boolean;
  documentScope?: boolean;
  children: ReactNode;
}) {
  const systemDark = useSystemDark();
  const dark =
    appearance.mode === "dark" || (appearance.mode === "system" && systemDark);
  const config = useMemo<ThemeConfig>(
    () => ({
      inherit: false,
      algorithm: [
        dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        ...(appearance.compact ? [theme.compactAlgorithm] : []),
      ],
      token: {
        colorPrimary: appearance.primaryColor,
        colorInfo: appearance.primaryColor,
        colorSuccess: appearance.successColor,
        colorWarning: appearance.warningColor,
        colorError: appearance.errorColor,
        colorBgLayout: themeBackground(appearance, dark),
        borderRadius: appearance.borderRadius,
        fontSize: portal ? 14 : 13,
        controlHeight: portal ? 42 : 34,
        fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        ...(dark
          ? {}
          : {
              colorText: "#303642",
              colorTextSecondary: "#646b78",
            }),
      },
      components: {
        Button: { primaryShadow: "none" },
        Table: {
          borderColor: "var(--app-table-border)",
          headerSplitColor: "var(--app-table-border)",
          headerBg: "var(--app-table-header)",
          rowHoverBg: "var(--app-table-hover)",
          stickyScrollBarBg: "var(--app-scrollbar-thumb)",
          cellPaddingBlock: appearance.compact ? 8 : 16,
          cellPaddingInline: appearance.compact ? 12 : 16,
          cellPaddingBlockMD: appearance.compact ? 8 : 14,
          cellPaddingInlineMD: 16,
          cellPaddingBlockSM: 8,
          cellPaddingInlineSM: 12,
        },
      },
    }),
    [appearance, dark, portal],
  );
  return (
    <ConfigProvider locale={zhCN} theme={config}>
      <ThemeVariables
        dark={dark}
        compact={appearance.compact}
        appearance={appearance}
        documentScope={documentScope}
      >
        {children}
      </ThemeVariables>
    </ConfigProvider>
  );
}

/** 同一组 Token 同时服务 Ant 组件、普通 HTML 和图表；弹窗挂到 body 时也读取当前全局变量。 */
function ThemeVariables({
  dark,
  compact,
  appearance,
  documentScope,
  children,
}: {
  dark: boolean;
  compact: boolean;
  appearance: Appearance;
  documentScope: boolean;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  const variables = useMemo(
    () => ({
      "--app-primary": token.colorPrimary,
      // 深色细文字在官方派生色上混入少量前景色，避免青色/深蓝色导航与选中背景对比不足。
      "--app-primary-text": dark
        ? `color-mix(in srgb, ${token.colorPrimaryTextHover} 70%, ${token.colorText} 30%)`
        : token.colorPrimaryText,
      "--app-primary-hover": token.colorPrimaryHover,
      "--app-primary-bg": token.colorPrimaryBg,
      "--app-primary-border": token.colorPrimaryBorder,
      "--app-text": token.colorText,
      "--app-text-secondary": token.colorTextSecondary,
      "--app-text-tertiary": token.colorTextTertiary,
      "--app-surface": token.colorBgContainer,
      "--app-elevated": token.colorBgElevated,
      "--app-layout": token.colorBgLayout,
      "--app-fill": token.colorFillAlter,
      "--app-border": token.colorBorderSecondary,
      "--app-border-strong": token.colorBorder,
      // 表格分隔线保留低对比度，同时带少量主题色；滚动条比背景更清楚但不抢占视觉。
      "--app-table-border": `color-mix(in srgb, ${token.colorPrimary} 16%, ${token.colorBorderSecondary})`,
      "--app-table-header": `color-mix(in srgb, ${token.colorPrimary} 4%, ${token.colorBgContainer})`,
      "--app-table-hover": `color-mix(in srgb, ${token.colorPrimary} 7%, ${token.colorBgContainer})`,
      "--app-scrollbar-thumb": `color-mix(in srgb, ${token.colorPrimary} 48%, ${token.colorBgContainer})`,
      "--app-scrollbar-hover": token.colorPrimaryHover,
      "--app-scrollbar-track": `color-mix(in srgb, ${token.colorPrimary} 5%, ${token.colorBgLayout})`,
      "--app-success": token.colorSuccessText,
      "--app-success-bg": token.colorSuccessBg,
      "--app-warning": token.colorWarningText,
      "--app-warning-bg": token.colorWarningBg,
      "--app-error": token.colorErrorText,
      "--app-error-bg": token.colorErrorBg,
      "--app-info": token.colorInfoText,
      "--app-info-bg": token.colorInfoBg,
      "--app-radius": `${token.borderRadius}px`,
      "--app-shadow": token.boxShadowSecondary,
      "--app-on-primary": "#fff",
      "--app-nav-bg":
        appearance.menuStyle === "dark"
          ? "#172333"
          : appearance.menuStyle === "tinted"
            ? `color-mix(in srgb, ${token.colorPrimary} 6%, ${token.colorBgContainer})`
            : token.colorBgContainer,
      "--app-nav-text":
        appearance.menuStyle === "dark" ? "#f1f5f9" : token.colorText,
      "--app-nav-muted":
        appearance.menuStyle === "dark" ? "#b8c5d6" : token.colorTextSecondary,
      "--app-nav-hover":
        appearance.menuStyle === "dark" ? "#263a50" : token.colorPrimaryBgHover,
      "--app-nav-active":
        appearance.menuStyle === "dark" ? "#ffffff" : token.colorPrimaryText,
      "--app-nav-active-bg":
        appearance.menuStyle === "dark"
          ? "#2c435c"
          : appearance.menuStyle === "tinted"
            ? token.colorPrimaryBgHover
            : token.colorPrimaryBg,
      "--app-nav-border":
        appearance.menuStyle === "dark"
          ? "#314254"
          : token.colorBorderSecondary,
      "--app-panel-border":
        appearance.surfaceStyle === "border"
          ? token.colorBorderSecondary
          : "transparent",
      "--app-panel-shadow":
        appearance.surfaceStyle === "shadow" ? token.boxShadowTertiary : "none",
      ...Object.fromEntries(
        chartColors(appearance).map((color, index) => [
          `--app-chart-${index + 1}`,
          color,
        ]),
      ),
    }),
    [token, dark, appearance],
  );
  useLayoutEffect(() => {
    if (!documentScope) return;
    const root = document.documentElement;
    const previous = Object.keys(variables).map((key) => [
      key,
      root.style.getPropertyValue(key),
    ]);
    const scheme = root.style.colorScheme;
    Object.entries(variables).forEach(([key, value]) =>
      root.style.setProperty(key, value),
    );
    root.style.colorScheme = dark ? "dark" : "light";
    return () => {
      previous.forEach(([key, value]) =>
        value
          ? root.style.setProperty(key, value)
          : root.style.removeProperty(key),
      );
      root.style.colorScheme = scheme;
    };
  }, [variables, dark, documentScope]);
  return (
    <div
      className="theme-scope"
      data-theme={dark ? "dark" : "light"}
      data-density={compact ? "compact" : "default"}
      data-surface={appearance.surfaceStyle}
      data-content-width={appearance.contentWidth}
      data-menu-style={appearance.menuStyle}
      style={
        {
          ...variables,
          colorScheme: dark ? "dark" : "light",
          color: token.colorText,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** 后台偏好保存在本浏览器；门户只读取服务端公开主题，访客不能通过后台偏好改变全站外观。 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const portal =
    pathname === "/" ||
    pathname.startsWith("/articles/") ||
    pathname.startsWith("/categories/");
  const site = useSite(portal);
  const [appearance, setAppearance] = useState(readPreference);
  const [previewAppearance, setPreviewAppearance] = useState<Appearance | null>(
    null,
  );
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null)
        setAppearance(readPreference());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const save = (value: Appearance) => {
    const validated = normalizeAppearance(value, ADMIN_APPEARANCE);
    setAppearance(validated);
    setPreviewAppearance(null);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
      return true;
    } catch {
      return false;
    }
  };
  const current = portal
    ? normalizeAppearance(site.data?.theme, PORTAL_APPEARANCE)
    : (previewAppearance ?? appearance);
  return (
    <AppearanceContext.Provider
      value={{ appearance, save, preview: setPreviewAppearance }}
    >
      <ThemeScope appearance={current} portal={portal} documentScope>
        <App>{children}</App>
      </ThemeScope>
    </AppearanceContext.Provider>
  );
}
