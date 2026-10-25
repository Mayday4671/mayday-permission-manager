import { App, Button, Form, Input, Select, Switch, Tag } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import {
  SESSION_POLICY_KEY,
  SessionPolicyInput,
  readSessionLimits,
  validateSessionLimits,
} from "../components/SessionPolicyInput";
import { ResourcePage } from "../components/ResourcePage";
import { StatusTag } from "../components/shared";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePageState } from "../lib/workspace";
import type { Entry } from "../types";

/** 类型切换改变输入约束，最终仍由服务器按同一类型再次验证，禁止仅靠前端校验。 */
function ParameterInput({
  value,
  onChange,
  id,
  valueType,
}: {
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
  valueType?: string;
}) {
  const watchedType = Form.useWatch("valueType");
  const type = valueType ?? watchedType;
  if (type === "BOOLEAN")
    return (
      <Switch
        id={id}
        checked={value === "true"}
        onChange={(enabled) => onChange?.(String(enabled))}
        checkedChildren="开启"
        unCheckedChildren="关闭"
      />
    );
  return (
    <Input.TextArea
      id={id}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      rows={type === "JSON" ? 7 : 3}
      maxLength={2000}
      placeholder={
        type === "JSON"
          ? '例如 {"enabled": true}'
          : type === "NUMBER"
            ? "请输入数字"
            : "请输入参数值"
      }
    />
  );
}
/** 参数使用登记类型校验；内置参数不可删除或更名，公共门户只读取后端明确公开的配置。 */
export function SettingsPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [group, setGroup] = usePageState("settings.group", "");
  return (
    <>
      <ResourcePage<Entry>
        resource="settings"
        endpoint="/system/entries/settings"
        title="系统配置"
        singular="参数"
        statusField="enabled"
        queryParams={{ groupName: group }}
        savedFilters={{
          keys: ["groupName"],
          apply: (values) =>
            setGroup(
              typeof values.groupName === "string" ? values.groupName : "",
            ),
        }}
        hasExtraFilters={Boolean(group)}
        onResetFilters={() => setGroup("")}
        defaults={{ groupName: "通用", valueType: "TEXT" }}
        // 排序未显示为表单字段，提交时需保留原值；新增参数使用默认排序。
        beforeSave={(values, record) => {
          if (
            record &&
            [SESSION_POLICY_KEY, "security.loginCaptchaEnabled"].includes(
              record.code,
            )
          )
            return {
              name: record.name,
              code: record.code,
              description: record.description,
              groupName: record.groupName,
              valueType: record.valueType,
              enabled: true,
              sortOrder: record.sortOrder ?? 0,
              value: values.value,
            };
          return { ...values, sortOrder: record?.sortOrder ?? 0 };
        }}
        canDelete={(record) => !record.builtIn}
        extraFilters={
          <Input
            style={{ width: 140 }}
            aria-label="参数分组"
            placeholder="按分组筛选"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            allowClear
          />
        }
        extraToolbar={
          can("settings:update") && (
            <Button
              onClick={async () => {
                try {
                  await api("/system/site-config/refresh", { method: "POST" });
                  void client.invalidateQueries();
                  message.success("参数缓存已刷新");
                } catch (error) {
                  message.error((error as Error).message);
                }
              }}
            >
              刷新缓存
            </Button>
          )
        }
        columns={[
          { title: "参数名称", dataIndex: "name", width: 180 },
          { title: "编码", dataIndex: "code", width: 190 },
          { title: "分组", dataIndex: "groupName", width: 110 },
          {
            title: "类型",
            dataIndex: "valueType",
            width: 90,
            render: (value, record) =>
              record.code === SESSION_POLICY_KEY
                ? "会话策略"
                : ((
                    {
                      TEXT: "文本",
                      NUMBER: "数字",
                      BOOLEAN: "开关",
                      JSON: "JSON",
                      EMAIL: "邮箱",
                    } as Record<string, string>
                  )[value] ?? value),
          },
          {
            title: "参数值",
            dataIndex: "value",
            width: 280,
            ellipsis: true,
            render: (value, record) => {
              if (record.code === SESSION_POLICY_KEY) {
                const limits = readSessionLimits(value);
                return `${limits.absoluteMinutes ?? "—"} 分钟 / 空闲 ${limits.idleMinutes ?? "—"} 分钟 / ${limits.maxPerUser ?? "—"} 个登录`;
              }
              return record.valueType === "BOOLEAN"
                ? value === "true"
                  ? "开启"
                  : "关闭"
                : value;
            },
          },
          {
            title: "内置",
            dataIndex: "builtIn",
            width: 80,
            render: (value) => (value ? <Tag>内置</Tag> : "—"),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 100,
            render: (value) => <StatusTag enabled={value} />,
          },
        ]}
        fields={(record, form) =>
          record?.code === SESSION_POLICY_KEY ? (
            <Form.Item
              name="value"
              rules={[
                { validator: (_, value) => validateSessionLimits(value) },
              ]}
            >
              <SessionPolicyInput />
            </Form.Item>
          ) : record?.code === "security.loginCaptchaEnabled" ? (
            <Form.Item name="value" label="登录验证码">
              <ParameterInput valueType="BOOLEAN" />
            </Form.Item>
          ) : (
            <>
              <div className="form-two-columns">
                <Form.Item
                  label="参数名称"
                  name="name"
                  rules={[{ required: true }]}
                >
                  <Input maxLength={100} />
                </Form.Item>
                <Form.Item
                  label="参数编码"
                  name="code"
                  rules={[
                    { required: true },
                    {
                      pattern: /^[A-Za-z0-9_.:-]{1,100}$/,
                      message: "仅支持字母、数字、点、冒号、下划线和短横线",
                    },
                  ]}
                >
                  <Input maxLength={100} disabled={record?.builtIn} />
                </Form.Item>
              </div>
              <div className="form-two-columns">
                <Form.Item
                  label="分组"
                  name="groupName"
                  rules={[{ required: true }]}
                >
                  <Input maxLength={64} />
                </Form.Item>
                <Form.Item
                  label="值类型"
                  name="valueType"
                  rules={[{ required: true }]}
                >
                  <Select
                    disabled={record?.builtIn}
                    onChange={(type) => {
                      if (type === "BOOLEAN")
                        form.setFieldValue("value", "false");
                    }}
                    options={[
                      { value: "TEXT", label: "文本" },
                      { value: "NUMBER", label: "数字" },
                      { value: "BOOLEAN", label: "布尔值" },
                      { value: "JSON", label: "JSON" },
                      { value: "EMAIL", label: "邮箱" },
                    ]}
                  />
                </Form.Item>
              </div>
              <Form.Item label="参数值" name="value">
                <ParameterInput />
              </Form.Item>
              <Form.Item label="说明" name="description">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
              <Form.Item label="状态" name="enabled" valuePropName="checked">
                <Switch
                  disabled={
                    record?.code === "security.loginCaptchaEnabled" ||
                    record?.code === "security.sessionPolicy"
                  }
                  checkedChildren="启用"
                  unCheckedChildren="停用"
                />
              </Form.Item>
            </>
          )
        }
      />
    </>
  );
}
