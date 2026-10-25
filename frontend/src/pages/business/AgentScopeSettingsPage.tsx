import { useEffect } from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Space,
  Tag,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryState, RefreshButton } from "../../components/shared";
import { api, jsonBody } from "../../lib/api";
import "./agentscope.css";

/**
 * 常用模型名称来自百炼当前公开的文本模型目录；保存前仍由服务端校验统一模型 ID 格式。
 * AutoComplete 保留自由输入能力，便于选择账号或区域内新发布的模型及微调模型。
 */
const COMMON_MODELS = [
  { value: "dashscope:qwen3.8-max", label: "Qwen3.8 Max · 旗舰推理" },
  { value: "dashscope:qwen3.7-plus", label: "Qwen3.7 Plus · 综合推荐" },
  { value: "dashscope:qwen3.8-flash", label: "Qwen3.8 Flash · 快速轻量" },
  { value: "dashscope:deepseek-v4-pro", label: "DeepSeek V4 Pro · 复杂任务" },
  { value: "dashscope:glm-5.2", label: "GLM 5.2 · 通用模型" },
  { value: "dashscope:kimi-k2.5", label: "Kimi K2.5 · 通用模型" },
  { value: "dashscope:MiniMax-M3", label: "MiniMax M3 · 通用模型" },
  { value: "dashscope:qwen3.7-flash", label: "Qwen3.7 Flash · 长文本" },
  { value: "dashscope:qwen-plus", label: "Qwen Plus · 兼容模型" },
];

interface AgentScopeSettings {
  moduleEnabled: boolean;
  modelReady: boolean;
  apiSecretConfigured: boolean;
  apiSecretOverrideStored: boolean;
  sdkVersion: string;
  model: string;
  requestTimeoutSeconds: number;
  maxMessageLength: number;
  maxContextMessages: number;
  systemPrompt: string;
  configurationSource: string;
}

interface SettingsFormValues extends Omit<
  AgentScopeSettings,
  | "moduleEnabled"
  | "modelReady"
  | "apiSecretConfigured"
  | "apiSecretOverrideStored"
  | "sdkVersion"
  | "configurationSource"
> {
  apiSecret?: string;
  clearApiSecret?: boolean;
}

/**
 * Gives authorized administrators a secret-safe place to change AgentScope settings. The same
 * component can render inside the AgentScope page so model changes do not require a trip to System
 * Management; the legacy route remains available for bookmarks during upgrades.
 *
 * <p>Secret input is write-only. The API only returns a configured flag; an empty value preserves
 * the existing key unless the administrator explicitly selects the clear action.
 */
export function AgentScopeSettingsPage({
  onSaved,
}: {
  /** Closes the containing dialog after a successful save; omitted for the legacy route. */
  onSaved?: () => void;
} = {}) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<SettingsFormValues>();
  const query = useQuery({
    queryKey: ["agentscope", "configuration"],
    queryFn: () => api<AgentScopeSettings>("/system/agentscope/configuration"),
  });

  useEffect(() => {
    if (query.data && !form.isFieldsTouched()) {
      form.setFieldsValue({
        model: query.data.model,
        requestTimeoutSeconds: query.data.requestTimeoutSeconds,
        maxMessageLength: query.data.maxMessageLength,
        maxContextMessages: query.data.maxContextMessages,
        systemPrompt: query.data.systemPrompt,
        apiSecret: "",
        clearApiSecret: false,
      });
    }
  }, [form, query.data]);

  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      retry={() => void query.refetch()}
    >
      {query.data && (
        <div className="agent-settings-page">
          {!query.data.moduleEnabled && (
            <Alert
              type="warning"
              showIcon
              message="智能体模块尚未启用"
              description="你可以先在此保存模型设置；启用智能体入口仍需部署人员打开 MODULE_AGENTSCOPE_ENABLED 并重启服务。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Card
            extra={
              <Space>
                <Tag color={query.data.modelReady ? "success" : "warning"}>
                  {query.data.modelReady ? "可用" : "待配置"}
                </Tag>
                <RefreshButton
                  onClick={() => void query.refetch()}
                  loading={query.isFetching}
                />
              </Space>
            }
          >
            <Form<SettingsFormValues>
              form={form}
              layout="vertical"
              onFinish={async (values) => {
                try {
                  const saved = await api<AgentScopeSettings>(
                    "/system/agentscope/configuration",
                    {
                      method: "PUT",
                      body: jsonBody({
                        model: values.model,
                        requestTimeoutSeconds: values.requestTimeoutSeconds,
                        maxMessageLength: values.maxMessageLength,
                        maxContextMessages: values.maxContextMessages,
                        systemPrompt: values.systemPrompt,
                        apiSecret: values.apiSecret?.trim() ?? "",
                        clearApiSecret: values.clearApiSecret ?? false,
                      }),
                    },
                  );
                  form.resetFields();
                  form.setFieldsValue({
                    model: saved.model,
                    requestTimeoutSeconds: saved.requestTimeoutSeconds,
                    maxMessageLength: saved.maxMessageLength,
                    maxContextMessages: saved.maxContextMessages,
                    systemPrompt: saved.systemPrompt,
                    apiSecret: "",
                    clearApiSecret: false,
                  });
                  await client.invalidateQueries({
                    queryKey: ["agentscope", "configuration"],
                  });
                  await client.invalidateQueries({
                    queryKey: ["agentscope", "status"],
                  });
                  message.success("智能体配置已保存并立即生效");
                  onSaved?.();
                } catch (error) {
                  message.error((error as Error).message);
                }
              }}
            >
              <div className="form-two-columns">
                <Form.Item
                  name="model"
                  label="模型"
                  rules={[
                    { required: true, message: "请选择或输入模型 ID" },
                    {
                      pattern: /^dashscope:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/,
                      message: "模型 ID 格式示例：dashscope:qwen-plus",
                    },
                  ]}
                  extra="可选择常用模型，或输入百炼中已开通的模型 ID。格式为 dashscope:模型ID；可用模型受账号和地域影响。"
                >
                  <AutoComplete
                    maxLength={120}
                    options={COMMON_MODELS}
                    filterOption={(input, option) =>
                      `${option?.label ?? ""} ${option?.value ?? ""}`
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                    placeholder="选择常用模型，或输入 dashscope:模型ID"
                  />
                </Form.Item>
                <Form.Item
                  name="apiSecret"
                  label="百炼 API Key"
                  extra={
                    query.data.apiSecretOverrideStored
                      ? "后台密钥已配置。留空表示保持当前密钥不变。"
                      : query.data.apiSecretConfigured
                        ? "当前使用部署默认密钥。输入新密钥后会由后台加密保存并覆盖默认值。"
                        : "请输入百炼 API Key；保存后只显示已配置状态，不会再回显密钥。"
                  }
                >
                  <Input.Password
                    autoComplete="new-password"
                    maxLength={512}
                    placeholder={
                      query.data.apiSecretOverrideStored
                        ? "留空以保持当前密钥"
                        : "输入百炼 API Key"
                    }
                  />
                </Form.Item>
              </div>
              {query.data.apiSecretOverrideStored && (
                <Form.Item
                  name="clearApiSecret"
                  valuePropName="checked"
                  style={{ marginBottom: 20 }}
                >
                  <Checkbox>清除后台保存的密钥，改用部署默认密钥</Checkbox>
                </Form.Item>
              )}
              <div className="form-two-columns">
                <Form.Item
                  name="requestTimeoutSeconds"
                  label="单次请求超时（秒）"
                  rules={[
                    { required: true, type: "number", min: 10, max: 300 },
                  ]}
                >
                  <InputNumber
                    min={10}
                    max={300}
                    step={10}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  name="maxMessageLength"
                  label="单条消息长度上限"
                  rules={[
                    { required: true, type: "number", min: 1, max: 4000 },
                  ]}
                >
                  <InputNumber
                    min={1}
                    max={4000}
                    step={100}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  name="maxContextMessages"
                  label="历史上下文消息数"
                  rules={[{ required: true, type: "number", min: 2, max: 100 }]}
                  tooltip="按完整问答保留，消息数取偶数。"
                >
                  <InputNumber
                    min={2}
                    max={100}
                    step={2}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </div>
              <Form.Item
                name="systemPrompt"
                label="系统提示词"
                rules={[{ required: true, whitespace: true, max: 4000 }]}
              >
                <Input.TextArea rows={5} maxLength={4000} showCount />
              </Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  保存配置
                </Button>
                <Button
                  onClick={() => {
                    form.resetFields();
                    void query.refetch();
                  }}
                >
                  放弃修改
                </Button>
              </Space>
            </Form>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
