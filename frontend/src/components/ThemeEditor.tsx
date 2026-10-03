import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  App,
  Button,
  ColorPicker,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import { Check, Copy, Download, Palette, RotateCcw } from "lucide-react";
import { FormDrawer } from "./FormDrawer";
import { ThemeScope, useSystemDark } from "../lib/theme";
import { useSite } from "../lib/portal";
import { useAdminAppearance } from "../lib/appearance-context";
import {
  ADMIN_APPEARANCE,
  PORTAL_APPEARANCE,
  THEME_COLORS,
  THEME_PRESETS,
  BACKGROUND_LABELS,
  MENU_STYLE_LABELS,
  CHART_PALETTE_LABELS,
  chartColors,
  importAppearance,
  normalizeAppearance,
  themeBackground,
  type Appearance,
} from "../lib/theme-model";

interface ThemeOption<T extends string> {
  value: T;
  label: string;
  preview: ReactNode;
}

/** 所有图示选项整块可点击，并暴露选中状态；键盘与鼠标共用同一更新入口。 */
function ThemeOptions<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ThemeOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="theme-options" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-label={`${label}：${option.label}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.preview}
          <span>{option.label}</span>
          {value === option.value && (
            <Check
              className="theme-option-check"
              size={14}
              aria-hidden="true"
            />
          )}
        </button>
      ))}
    </div>
  );
}

/** 缩略图由本地 HTML/CSS 组成，无外部图片依赖，也不会改变全局主题。 */
function ThemeThumbnail({
  appearance,
  mode = "light",
  portal = false,
}: {
  appearance: Appearance;
  mode?: Appearance["mode"];
  portal?: boolean;
}) {
  const dark = mode === "dark";
  return (
    <span
      aria-hidden="true"
      className={`theme-thumbnail ${portal ? "is-portal" : ""} ${mode === "system" ? "is-system" : ""}`}
      style={
        {
          "--thumb-primary": appearance.primaryColor,
          "--thumb-layout": themeBackground(appearance, dark),
          "--thumb-surface": dark ? "#252525" : "#fff",
          "--thumb-nav":
            appearance.menuStyle === "dark"
              ? "#172333"
              : appearance.menuStyle === "tinted"
                ? `color-mix(in srgb, ${appearance.primaryColor} 15%, ${dark ? "#252525" : "#fff"})`
                : dark
                  ? "#252525"
                  : "#fff",
        } as CSSProperties
      }
    >
      <i className="thumb-navigation">
        <b />
        <b />
        <b />
      </i>
      <i className="thumb-topbar" />
      <i className="thumb-content">
        <b />
        <b />
        <b />
        <em />
      </i>
    </span>
  );
}

function ThemeColorField({
  label,
  value,
  onChange,
  showLabel = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  showLabel?: boolean;
}) {
  return (
    <div className="appearance-field">
      {showLabel && <label>{label}</label>}
      <ColorPicker
        value={value}
        disabledAlpha
        format="hex"
        onChange={(color) => onChange(color.toHexString())}
      >
        <Button className="custom-color-button" aria-label={`自定义${label}`}>
          <span style={{ background: value }} />
          {label}
          <code>{value}</code>
        </Button>
      </ColorPicker>
    </div>
  );
}

/** 前后台共用的受控主题编辑器。配置只描述外观，保持现有单侧菜单、页签和业务权限。 */
export function AppearanceControls({
  value = ADMIN_APPEARANCE,
  onChange,
  portal = false,
  previewPanel,
}: {
  value?: Appearance;
  onChange?: (value: Appearance) => void;
  portal?: boolean;
  previewPanel?: ReactNode;
}) {
  const fieldId = useId();
  const change = (patch: Partial<Appearance>) =>
    onChange?.({ ...value, ...patch });
  const selectedPreset =
    THEME_PRESETS.find((preset) =>
      Object.entries(preset).every(
        ([key, item]) =>
          key === "name" ||
          (portal && key !== "primaryColor") ||
          value[key as keyof Appearance] === item,
      ),
    )?.name ?? "";
  return (
    <Tabs
      className="theme-editor-tabs"
      items={[
        {
          key: "style",
          label: "主题风格",
          children: (
            <div className="appearance-controls">
              <div className="appearance-field">
                <label>显示模式</label>
                <ThemeOptions
                  label="显示模式"
                  value={value.mode}
                  onChange={(mode) => change({ mode })}
                  options={(
                    [
                      ["light", "浅色"],
                      ["dark", "深色"],
                      ["system", "跟随系统"],
                    ] as const
                  ).map(([mode, label]) => ({
                    value: mode,
                    label,
                    preview: (
                      <ThemeThumbnail
                        appearance={value}
                        mode={mode}
                        portal={portal}
                      />
                    ),
                  }))}
                />
              </div>
              <div className="appearance-field">
                <label>主题预设</label>
                <ThemeOptions
                  label="主题预设"
                  value={selectedPreset}
                  options={THEME_PRESETS.map((preset) => ({
                    value: preset.name,
                    label: preset.name,
                    preview: (
                      <ThemeThumbnail
                        appearance={{ ...value, ...preset }}
                        portal={portal}
                      />
                    ),
                  }))}
                  onChange={(name) => {
                    const preset = THEME_PRESETS.find(
                      (item) => item.name === name,
                    );
                    if (preset) {
                      const { name: _name, ...patch } = preset;
                      change(
                        portal ? { primaryColor: patch.primaryColor } : patch,
                      );
                    }
                  }}
                />
              </div>
              <div className="appearance-field">
                <label>{portal ? "浅色主色" : "主题色"}</label>
                <div
                  className="appearance-colors"
                  role="group"
                  aria-label="预设主题色"
                >
                  {THEME_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      aria-label={color.name}
                      aria-pressed={
                        value.primaryColor.toLowerCase() === color.value
                      }
                      style={{ background: color.value }}
                      onClick={() => change({ primaryColor: color.value })}
                    >
                      {value.primaryColor.toLowerCase() === color.value && (
                        <Check size={17} />
                      )}
                    </button>
                  ))}
                </div>
                <ThemeColorField
                  label="主题色"
                  showLabel={false}
                  value={value.primaryColor}
                  onChange={(primaryColor) => change({ primaryColor })}
                />
              </div>
            </div>
          ),
        },
        {
          key: "layout",
          label: "布局外观",
          children: (
            <div className="appearance-controls">
              <div className="appearance-field">
                <label>{portal ? "导航风格" : "菜单风格"}</label>
                <ThemeOptions
                  label={portal ? "导航风格" : "菜单风格"}
                  value={value.menuStyle}
                  onChange={(menuStyle) => change({ menuStyle })}
                  options={(
                    Object.keys(MENU_STYLE_LABELS) as Appearance["menuStyle"][]
                  ).map((menuStyle) => ({
                    value: menuStyle,
                    label: MENU_STYLE_LABELS[menuStyle],
                    preview: (
                      <ThemeThumbnail
                        appearance={{ ...value, menuStyle }}
                        portal={portal}
                      />
                    ),
                  }))}
                />
              </div>
              <div className="theme-field-pair">
                <div className="appearance-field">
                  <label>页面背景</label>
                  <Select
                    aria-label="页面背景"
                    value={value.background}
                    onChange={(background) => change({ background })}
                    options={Object.entries(BACKGROUND_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </div>
                <div className="appearance-field">
                  <label htmlFor={`${fieldId}-radius`}>圆角</label>
                  <Select
                    id={`${fieldId}-radius`}
                    aria-label="圆角"
                    value={value.borderRadius}
                    onChange={(borderRadius) => change({ borderRadius })}
                    options={[0, 4, 6, 8, 12, 16].map((size) => ({
                      value: size,
                      label: size === 0 ? "直角" : `${size} px`,
                    }))}
                  />
                </div>
              </div>
              <div className="appearance-field">
                <label>容器样式</label>
                <Segmented
                  aria-label="容器样式"
                  block
                  value={value.surfaceStyle}
                  options={[
                    { value: "border", label: "边框" },
                    { value: "shadow", label: "阴影" },
                  ]}
                  onChange={(surfaceStyle) =>
                    change({
                      surfaceStyle: surfaceStyle as Appearance["surfaceStyle"],
                    })
                  }
                />
              </div>
              <div className="appearance-field">
                <label>内容宽度</label>
                <Segmented
                  aria-label="内容宽度"
                  block
                  value={value.contentWidth}
                  options={[
                    { value: "full", label: "铺满" },
                    { value: "boxed", label: "居中（1600 px）" },
                  ]}
                  onChange={(contentWidth) =>
                    change({
                      contentWidth: contentWidth as Appearance["contentWidth"],
                    })
                  }
                />
              </div>
              <div className="appearance-switch">
                <label htmlFor={`${fieldId}-compact`}>紧凑布局</label>
                <Switch
                  id={`${fieldId}-compact`}
                  checked={value.compact}
                  onChange={(compact) => change({ compact })}
                />
              </div>
            </div>
          ),
        },
        {
          key: "colors",
          label: "图表与状态",
          children: (
            <div className="appearance-controls">
              <div className="appearance-field">
                <label>图表色板</label>
                <ThemeOptions
                  label="图表色板"
                  value={value.chartPalette}
                  onChange={(chartPalette) => change({ chartPalette })}
                  options={(
                    Object.keys(
                      CHART_PALETTE_LABELS,
                    ) as Appearance["chartPalette"][]
                  ).map((chartPalette) => ({
                    value: chartPalette,
                    label: CHART_PALETTE_LABELS[chartPalette],
                    preview: (
                      <span className="palette-swatch" aria-hidden="true">
                        {chartColors({ ...value, chartPalette }).map(
                          (color, index) => (
                            <i key={index} style={{ background: color }} />
                          ),
                        )}
                      </span>
                    ),
                  }))}
                />
              </div>
              <ThemeColorField
                label="成功色"
                value={value.successColor}
                onChange={(successColor) => change({ successColor })}
              />
              <ThemeColorField
                label="警告色"
                value={value.warningColor}
                onChange={(warningColor) => change({ warningColor })}
              />
              <ThemeColorField
                label="错误色"
                value={value.errorColor}
                onChange={(errorColor) => change({ errorColor })}
              />
            </div>
          ),
        },
        ...(previewPanel
          ? [{ key: "preview", label: "效果预览", children: previewPanel }]
          : []),
      ].filter(
        (item) => !portal || item.key === "style" || item.key === "preview",
      )}
    />
  );
}

/** 独立范围预览：前台草稿不会污染后台控件，也不会在保存前写入公共站点。 */
export function AppearancePreview({
  appearance,
  portal = false,
}: {
  appearance: Appearance;
  portal?: boolean;
}) {
  const site = useSite(portal);
  const systemDark = useSystemDark();
  const dark =
    appearance.mode === "dark" || (appearance.mode === "system" && systemDark);
  if (portal)
    return (
      <ThemeScope
        appearance={{
          ...appearance,
          menuStyle: "light",
          primaryColor: dark
            ? (site.data?.nightPrimaryColor ?? "#53d5be")
            : appearance.primaryColor,
        }}
        portal
      >
        <div className="portal-appearance-preview" aria-label="主题效果预览">
          <div className="portal-preview-navigation">
            <b>Mayday</b>
            <span>首页</span>
            <span>使用指南</span>
            <span>公告</span>
          </div>
          <div className="portal-preview-hero">
            <div>
              <h3>开始使用 Mayday</h3>
              <p>查找操作指南和服务资料</p>
              <Button type="primary" size="small">
                查看指南
              </Button>
            </div>
            <img
              src="/images/portal-redesign-hero.png"
              alt="明亮办公桌上的笔记本电脑"
            />
          </div>
          <div className="portal-preview-articles">
            {[
              ["使用指南", "/images/portal-guide.webp"],
              ["产品动态", "/images/portal-update.webp"],
              ["团队故事", "/images/portal-redesign-team.png"],
            ].map(([name, src]) => (
              <div key={name}>
                <img src={src} alt="" />
                <b>{name}</b>
                <p>阅读最新内容与服务信息</p>
              </div>
            ))}
          </div>
        </div>
      </ThemeScope>
    );
  return (
    <ThemeScope appearance={appearance} portal={portal}>
      <div
        className={`appearance-preview ${portal ? "portal-theme-preview" : ""}`}
        aria-label="主题效果预览"
      >
        <div className="appearance-preview-head">
          <b>{portal ? "客户服务中心" : "后台管理"}</b>
          <Tag>预览</Tag>
        </div>
        <div className="appearance-preview-body">
          <div className="appearance-preview-nav">
            <span className="selected">{portal ? "使用指南" : "用户管理"}</span>
            <span>{portal ? "公告" : "角色权限"}</span>
          </div>
          <div className="appearance-preview-content">
            <h3>{portal ? "最新内容" : "成员列表"}</h3>
            <div className="appearance-preview-actions">
              <Input placeholder="输入关键词" aria-label="预览搜索框" />
              <Button type="primary">查询</Button>
            </div>
            <div className="appearance-preview-row">
              <span>{portal ? "账户使用指南" : "示例成员"}</span>
              <Tag color="success">{portal ? "已发布" : "启用"}</Tag>
            </div>
            <div className="appearance-preview-row">
              <span>{portal ? "近期产品更新" : "示例角色"}</span>
              <Tag color="warning">{portal ? "更新" : "待处理"}</Tag>
            </div>
            <div className="appearance-preview-row">
              <span>{portal ? "服务公告" : "停用成员"}</span>
              <Tag color="error">{portal ? "重要" : "停用"}</Tag>
            </div>
          </div>
          <div className="appearance-preview-chart">
            <svg viewBox="0 0 360 95" role="img" aria-label="图表色板预览">
              <path
                d="M8 74 L60 60 L115 69 L170 27 L225 41 L280 16 L350 31"
                stroke="var(--app-chart-1)"
              />
              <path
                d="M8 84 L60 72 L115 42 L170 51 L225 24 L280 45 L350 12"
                stroke="var(--app-chart-2)"
              />
              <path
                d="M8 60 L60 48 L115 58 L170 67 L225 51 L280 64 L350 52"
                stroke="var(--app-chart-3)"
              />
            </svg>
            <span>图表色板</span>
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}

/** 配置导入只接受 JSON 数据，经同一契约校验后才写入草稿；复制不会写入业务数据库。 */
function ThemeActions({
  value,
  onChange,
  fallback,
}: {
  value: Appearance;
  onChange: (value: Appearance) => void;
  fallback: Appearance;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="theme-actions">
      <Button
        icon={<Copy size={15} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
            message.success("主题配置已复制");
          } catch {
            message.error("浏览器未允许复制，请检查剪贴板权限");
          }
        }}
      >
        复制配置
      </Button>
      <Button
        icon={<Download size={15} />}
        onClick={() => {
          setText("");
          setOpen(true);
        }}
      >
        导入配置
      </Button>
      <Button
        icon={<RotateCcw size={15} />}
        onClick={() => onChange({ ...fallback })}
      >
        恢复默认
      </Button>
      <Modal
        title="导入主题配置"
        zIndex={1210}
        open={open}
        centered
        mask={{ closable: false }}
        okText="导入"
        cancelText="取消"
        onCancel={() => setOpen(false)}
        onOk={() => {
          try {
            onChange(importAppearance(text, fallback));
            setOpen(false);
            message.success("主题配置已导入，请保存以保留");
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : "主题配置无效",
            );
          }
        }}
      >
        <Input.TextArea
          aria-label="主题 JSON 配置"
          placeholder="粘贴复制的主题 JSON 配置"
          rows={10}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Modal>
    </div>
  );
}

/** 后台偏好和独立前台主题复用编辑控件；临时预览只影响当前界面，保存边界由外层表单负责。 */
export function ThemeFormContent({
  portal = false,
  drawer = false,
}: {
  portal?: boolean;
  drawer?: boolean;
}) {
  const form = Form.useFormInstance();
  const fallback = portal ? PORTAL_APPEARANCE : ADMIN_APPEARANCE;
  const appearance = Form.useWatch<Appearance>("appearance", form) ?? fallback;
  return (
    <>
      <p className="appearance-description">
        {portal
          ? "配置默认明暗和浅色主色；暗夜强调色与访客切换在门户栏目中设置。"
          : "调整即时预览，保存后保留；取消恢复原主题。"}
      </p>
      <div
        className={`appearance-editor ${drawer ? "theme-drawer-editor" : ""}`}
      >
        <Form.Item name="appearance" noStyle>
          <AppearanceControls
            portal={portal}
            previewPanel={
              drawer && portal ? (
                <AppearancePreview appearance={appearance} portal />
              ) : undefined
            }
          />
        </Form.Item>
        {!drawer && (
          <AppearancePreview appearance={appearance} portal={portal} />
        )}
      </div>
      <ThemeActions
        value={appearance}
        fallback={fallback}
        onChange={(value) => form.setFieldValue("appearance", value)}
      />
    </>
  );
}

/** 后台整页预览仅保留在内存；取消、关闭或卸载均恢复保存值，保存异常明确提示。 */
export function AdminThemeButton() {
  const { appearance, save, preview } = useAdminAppearance();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ appearance: Appearance }>();
  const draft = Form.useWatch<Appearance>("appearance", form);
  useEffect(() => {
    if (open && draft) preview(normalizeAppearance(draft, ADMIN_APPEARANCE));
  }, [open, draft, preview]);
  useEffect(() => () => preview(null), [preview]);
  const close = () => {
    preview(null);
    setOpen(false);
  };
  return (
    <>
      <Tooltip title="后台主题">
        <Button
          type="text"
          aria-label="后台主题"
          icon={<Palette size={19} />}
          onClick={() => {
            form.setFieldsValue({ appearance: { ...appearance } });
            setOpen(true);
          }}
        />
      </Tooltip>
      <FormDrawer
        title="后台主题"
        open={open}
        form={form}
        confirmDiscard={false}
        onCancel={close}
        onSubmit={async (values) => {
          const persisted = save(values.appearance);
          setOpen(false);
          if (persisted) message.success("后台主题已保存");
          else
            message.warning(
              "主题已应用，但浏览器未允许保存，刷新后可能恢复默认值",
            );
        }}
      >
        <ThemeFormContent drawer />
      </FormDrawer>
    </>
  );
}
