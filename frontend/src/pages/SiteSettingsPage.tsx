import { useState } from "react";
import { App, Button, Descriptions, Form, Input, Space } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormModal } from "../components/FormModal";
import { FormDrawer } from "../components/FormDrawer";
import { QueryState, RefreshButton } from "../components/shared";
import { api, jsonBody } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Entry } from "../types";
import { AppearancePreview, ThemeFormContent } from "../components/ThemeEditor";
import {
  PORTAL_APPEARANCE,
  normalizeAppearance,
  type Appearance,
} from "../lib/theme-model";

interface SiteSettings {
  fields: {
    key: string;
    label: string;
    type: string;
    maxLength: number;
    fallback: string;
  }[];
  entries: Entry[];
  preview: Record<string, string>;
}
/** 字段定义来自后端白名单；编辑时冻结原版本，不能用后台刷新后的新版本覆盖他人的修改。 */
export function SiteSettingsPage({
  themeOnly = false,
}: { themeOnly?: boolean } = {}) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<Entry[]>([]);
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: ["site-config"],
    queryFn: () => api<SiteSettings>("/system/site-config"),
  });
  // 站点文本与主题分别编辑、分别携带版本，避免保存联系方式时覆盖正在编辑的前台主题。
  const fields = (query.data?.fields ?? []).filter(
    (field) => field.key !== "site.theme",
  );
  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      retry={() => void query.refetch()}
    >
      {!themeOnly && (
        <section className="panel module-panel">
          <div className="module-toolbar module-toolbar-actions">
            <Space>
              <RefreshButton
                onClick={() => void query.refetch()}
                loading={query.isFetching}
              />
              {can("settings:update") && (
                <Button
                  type="primary"
                  onClick={() => {
                    setOriginal(query.data?.entries ?? []);
                    form.resetFields();
                    form.setFieldsValue(query.data?.preview);
                    setOpen(true);
                  }}
                >
                  编辑配置
                </Button>
              )}
            </Space>
          </div>
          <Descriptions
            bordered
            column={{ xs: 1, sm: 2 }}
            items={fields.map((field) => ({
              key: field.key,
              label: field.label,
              children: query.data?.preview[field.key] || "—",
            }))}
          />
        </section>
      )}
      {query.data?.fields.some((field) => field.key === "site.theme") && (
        <SiteAppearanceSettings data={query.data} />
      )}
      <FormModal
        title="编辑网站配置"
        open={open}
        form={form}
        width={760}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          const data = Object.fromEntries(
            fields.map((field) => [
              field.key,
              {
                value: values[field.key] ?? "",
                version: original.find((entry) => entry.code === field.key)
                  ?.version,
              },
            ]),
          );
          await api("/system/site-config", {
            method: "PUT",
            body: jsonBody(data),
          });
          message.success("网站配置已保存");
          setOpen(false);
          void client.invalidateQueries();
        }}
      >
        <div className="form-two-columns">
          {fields.map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={field.label}
              rules={[
                { required: field.key === "site.name" },
                ...(field.type === "EMAIL"
                  ? [{ type: "email" as const, message: "请输入有效邮箱" }]
                  : []),
              ]}
            >
              {field.key === "site.description" ? (
                <Input.TextArea rows={3} maxLength={field.maxLength} />
              ) : (
                <Input maxLength={field.maxLength} />
              )}
            </Form.Item>
          ))}
        </div>
      </FormModal>
    </QueryState>
  );
}

/** 前台主题是网站级配置，沿用真实的查看/修改权限与乐观锁，不跟随后台个人主题变化。 */
function SiteAppearanceSettings({ data }: { data: SiteSettings }) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<number | undefined>();
  const [form] = Form.useForm<{ appearance: Appearance }>();
  let saved: Appearance;
  try {
    saved = normalizeAppearance(
      JSON.parse(data.preview["site.theme"] ?? "null"),
      PORTAL_APPEARANCE,
    );
  } catch {
    saved = { ...PORTAL_APPEARANCE };
  }
  return (
    <>
      <section className="panel module-panel" style={{ marginTop: 20 }}>
        <div className="module-toolbar">
          <b>前台主题</b>
          {can("settings:update") && (
            <Button
              type="primary"
              onClick={() => {
                setVersion(
                  data.entries.find((entry) => entry.code === "site.theme")
                    ?.version,
                );
                form.setFieldsValue({ appearance: { ...saved } });
                setOpen(true);
              }}
            >
              配置前台主题
            </Button>
          )}
        </div>
        <div className="site-appearance-summary">
          <Descriptions
            column={1}
            items={[
              {
                key: "mode",
                label: "显示模式",
                children: {
                  light: "浅色",
                  dark: "深色",
                  system: "跟随访客系统",
                }[saved.mode],
              },
              {
                key: "color",
                label: "浅色主色",
                children: (
                  <span className="theme-color-value">
                    <i style={{ background: saved.primaryColor }} />
                    {saved.primaryColor}
                  </span>
                ),
              },
              {
                key: "layout",
                label: "阅读布局",
                children: "蓝白 / 海军蓝，随窗口调整，不跟随后台个人布局",
              },
            ]}
          />
          <AppearancePreview appearance={saved} portal />
        </div>
      </section>
      <FormDrawer
        title="配置前台主题"
        open={open}
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          await api("/system/site-config", {
            method: "PUT",
            body: jsonBody({
              "site.theme": {
                value: JSON.stringify(values.appearance),
                version,
              },
            }),
          });
          message.success("前台主题已保存，打开前台即可查看");
          setOpen(false);
          void client.invalidateQueries({ queryKey: ["site-config"] });
          void client.invalidateQueries({ queryKey: ["site"] });
          void client.invalidateQueries({ queryKey: ["entries", "settings"] });
        }}
      >
        <ThemeFormContent portal drawer />
      </FormDrawer>
    </>
  );
}
