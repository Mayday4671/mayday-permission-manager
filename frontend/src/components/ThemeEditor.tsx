import { useId, useState } from "react";
import {
  App,
  Button,
  ColorPicker,
  Form,
  Input,
  Segmented,
  Select,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { FormModal } from "./FormModal";
import { ThemeScope } from "../lib/theme";
import { useAdminAppearance } from "../lib/appearance-context";
import {
  ADMIN_APPEARANCE,
  PORTAL_APPEARANCE,
  THEME_COLORS,
  type Appearance,
} from "../lib/theme-model";

/** 共用的受控主题编辑器：个人偏好和站点配置仅保存方式不同，选项与预览保持一致。 */
export function AppearanceControls({
  value = ADMIN_APPEARANCE,
  onChange,
}: {
  value?: Appearance;
  onChange?: (value: Appearance) => void;
}) {
  const fieldId = useId();
  const change = (patch: Partial<Appearance>) =>
    onChange?.({ ...value, ...patch });
  return (
    <div className="appearance-controls">
      <div className="appearance-field">
        <label>显示模式</label>
        <Segmented<Appearance["mode"]>
          block
          aria-label="显示模式"
          value={value.mode}
          onChange={(mode) => change({ mode })}
          options={[
            { value: "light", label: "浅色", icon: <Sun size={16} /> },
            { value: "dark", label: "深色", icon: <Moon size={16} /> },
            { value: "system", label: "跟随系统", icon: <Monitor size={16} /> },
          ]}
        />
      </div>
      <div className="appearance-field">
        <label>主题色</label>
        <div className="appearance-colors" role="group" aria-label="预设主题色">
          {THEME_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-label={color.name}
              aria-pressed={value.primaryColor.toLowerCase() === color.value}
              style={{ background: color.value }}
              onClick={() => change({ primaryColor: color.value })}
            >
              {value.primaryColor.toLowerCase() === color.value && (
                <Check size={17} />
              )}
            </button>
          ))}
        </div>
        <ColorPicker
          value={value.primaryColor}
          disabledAlpha
          format="hex"
          showText
          presets={[
            {
              label: "常用颜色",
              colors: THEME_COLORS.map((color) => color.value),
            },
          ]}
          onChange={(color) => change({ primaryColor: color.toHexString() })}
        >
          <Button className="custom-color-button" aria-label="自定义主题色">
            <span style={{ background: value.primaryColor }} />
            自定义颜色 <code>{value.primaryColor}</code>
          </Button>
        </ColorPicker>
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
      <div className="appearance-switch">
        <label htmlFor={`${fieldId}-compact`}>紧凑布局</label>
        <Switch
          id={`${fieldId}-compact`}
          checked={value.compact}
          onChange={(compact) => change({ compact })}
        />
      </div>
    </div>
  );
}

/** 预览使用独立 ConfigProvider，尚未保存的前台主题不会污染后台表单、弹窗或公开网站。 */
export function AppearancePreview({
  appearance,
  portal = false,
}: {
  appearance: Appearance;
  portal?: boolean;
}) {
  return (
    <ThemeScope appearance={appearance} portal={portal}>
      <div
        className={`appearance-preview ${portal ? "portal-theme-preview" : ""}`}
        aria-label="主题效果预览"
      >
        <div className="appearance-preview-head">
          <b>{portal ? "客户服务中心" : "后台管理"}</b>
          <Tag color="processing">效果预览</Tag>
        </div>
        <div className="appearance-preview-body">
          <div className="appearance-preview-nav">
            <span className="selected">
              {portal ? "资讯与帮助" : "用户管理"}
            </span>
            <span>{portal ? "使用指南" : "角色权限"}</span>
          </div>
          <div className="appearance-preview-content">
            <h3>{portal ? "服务公告" : "成员列表"}</h3>
            <div className="appearance-preview-actions">
              <Input placeholder="输入关键词" aria-label="预览搜索框" />
              <Button type="primary">搜索</Button>
            </div>
            <div className="appearance-preview-row">
              <span>{portal ? "账户使用指南" : "示例成员"}</span>
              <Tag color="success">{portal ? "已发布" : "启用"}</Tag>
            </div>
            <div className="appearance-preview-row">
              <span>{portal ? "近期产品更新" : "示例角色"}</span>
              <Button type="link">查看</Button>
            </div>
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}

export function ThemeFormContent({ portal = false }: { portal?: boolean }) {
  const form = Form.useFormInstance();
  const fallback = portal ? PORTAL_APPEARANCE : ADMIN_APPEARANCE;
  const appearance = Form.useWatch<Appearance>("appearance", form) ?? fallback;
  return (
    <>
      <p className="appearance-description">
        {portal
          ? "保存后统一应用到前台首页与文章页。"
          : "保存到当前浏览器，刷新后保留。"}
      </p>
      <div className="appearance-editor">
        <Form.Item name="appearance" noStyle>
          <AppearanceControls />
        </Form.Item>
        <AppearancePreview appearance={appearance} portal={portal} />
      </div>
      <Button
        className="appearance-reset"
        onClick={() => form.setFieldValue("appearance", { ...fallback })}
      >
        恢复默认值
      </Button>
    </>
  );
}

/** 后台始终通过弹窗配置主题，遵循现有操作习惯；取消不保存，保存失败明确告知持久化状态。 */
export function AdminThemeButton() {
  const { appearance, save } = useAdminAppearance();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ appearance: Appearance }>();
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
      <FormModal
        title="后台主题"
        open={open}
        form={form}
        width={860}
        onCancel={() => setOpen(false)}
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
        <ThemeFormContent />
      </FormModal>
    </>
  );
}
