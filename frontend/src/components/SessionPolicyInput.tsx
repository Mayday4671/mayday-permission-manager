import { Form, InputNumber } from "antd";

export const SESSION_POLICY_KEY = "security.sessionPolicy";

interface SessionLimits {
  absoluteMinutes: number | null;
  idleMinutes: number | null;
  maxPerUser: number | null;
}

/** 系统参数仍保存原子 JSON，页面仅将已知数字字段转换为可编辑控件。 */
export function readSessionLimits(value?: string): SessionLimits {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "{}");
  } catch {
    parsed = null;
  }
  const fields =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    absoluteMinutes:
      typeof fields.absoluteMinutes === "number"
        ? fields.absoluteMinutes
        : null,
    idleMinutes:
      typeof fields.idleMinutes === "number" ? fields.idleMinutes : null,
    maxPerUser:
      typeof fields.maxPerUser === "number" ? fields.maxPerUser : null,
  };
}

/** 保存前校验完整策略，服务端继续执行同样的范围和跨字段约束。 */
export function validateSessionLimits(value?: string): Promise<void> {
  const limits = readSessionLimits(value);
  if (
    limits.absoluteMinutes == null ||
    !Number.isInteger(limits.absoluteMinutes) ||
    limits.absoluteMinutes < 5 ||
    limits.absoluteMinutes > 10080
  )
    return Promise.reject(new Error("登录有效期请输入 5–10080 的整数"));
  if (
    limits.idleMinutes == null ||
    !Number.isInteger(limits.idleMinutes) ||
    limits.idleMinutes < 1
  )
    return Promise.reject(new Error("空闲超时请输入大于零的整数"));
  if (limits.idleMinutes > limits.absoluteMinutes)
    return Promise.reject(new Error("空闲超时不能超过登录有效期"));
  if (
    limits.maxPerUser == null ||
    !Number.isInteger(limits.maxPerUser) ||
    limits.maxPerUser < 1 ||
    limits.maxPerUser > 20
  )
    return Promise.reject(new Error("同时登录上限请输入 1–20 的整数"));
  return Promise.resolve();
}

/** 复用列表编辑弹窗的 value/onChange 协议，不再创建第二套查询、保存或常驻配置面板。 */
export function SessionPolicyInput({
  value,
  onChange,
  id,
}: {
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
}) {
  const limits = readSessionLimits(value);
  const fields = [
    {
      key: "absoluteMinutes",
      label: "登录有效期（分钟）",
      min: 5,
      max: 10080,
      tip: "缩短影响已有登录；调长不延长已签发的固定到期时间。",
    },
    {
      key: "idleMinutes",
      label: "空闲超时（分钟）",
      min: 1,
      max: 10080,
      tip: "按无认证请求计算，页面自动刷新也算活动。",
    },
    {
      key: "maxPerUser",
      label: "同时登录上限（个）",
      min: 1,
      max: 20,
      tip: "下次登录时执行，超限退出最早的会话。",
    },
  ] as const;
  return (
    <div id={id}>
      {fields.map((field) => (
        <Form.Item
          key={field.key}
          label={field.label}
          htmlFor={`${id}_${field.key}`}
          tooltip={field.tip}
        >
          <InputNumber
            id={`${id}_${field.key}`}
            aria-label={field.label}
            value={limits[field.key]}
            min={field.min}
            max={field.max}
            precision={0}
            style={{ width: "100%" }}
            onChange={(next) =>
              onChange?.(JSON.stringify({ ...limits, [field.key]: next }))
            }
          />
        </Form.Item>
      ))}
    </div>
  );
}
