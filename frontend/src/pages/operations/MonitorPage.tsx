import { useState } from "react";
import {
  App,
  Button,
  Descriptions,
  Form,
  InputNumber,
  Select,
  Statistic,
  Switch,
  Tag,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FormModal } from "../../components/FormModal";
import { QueryState, formatTime } from "../../components/shared";
import {
  monitorSnapshot,
  monitorHistory,
  monitorPolicy,
  monitorRecipients,
  saveMonitorPolicy,
} from "../../lib/general-platform";
import type { MonitorPolicy } from "../../lib/general-platform";
import { useAuth } from "../../lib/auth";
import "./operations.css";

/** 实时指标、有限历史和告警策略各用独立接口，指标缺失明确显示不可用，不伪造演示趋势。 */
export function MonitorPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [configuring, setConfiguring] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [form] = Form.useForm<MonitorPolicy>();
  const current = useQuery({
    queryKey: ["monitor"],
    queryFn: monitorSnapshot,
    refetchInterval: 10000,
  });
  const history = useQuery({
    queryKey: ["monitor-history", minutes],
    queryFn: () => monitorHistory(minutes),
    refetchInterval: 30000,
  });
  const policy = useQuery({
    queryKey: ["monitor-policy"],
    queryFn: monitorPolicy,
  });
  const recipients = useQuery({
    queryKey: ["monitor-recipients"],
    queryFn: monitorRecipients,
    enabled: configuring && can("monitor:configure"),
  });
  const snapshot = current.data;
  const chartData = (history.data ?? []).map((sample) => ({
    ...sample,
    time: sample.createdAt.slice(11, 16),
    heapPercent:
      sample.heapMax > 0
        ? Math.round((sample.heapUsed * 1000) / sample.heapMax) / 10
        : null,
    cpuUsage:
      sample.cpuUsage < 0 ? null : Math.round(sample.cpuUsage * 10) / 10,
  }));
  return (
    <QueryState
      loading={current.isLoading}
      error={current.error}
      retry={() => void current.refetch()}
    >
      {snapshot && (
        <div className="monitor-page">
          <div className="monitor-toolbar">
            <Select
              aria-label="趋势时间窗口"
              value={minutes}
              onChange={setMinutes}
              options={[
                { value: 15, label: "最近15分钟" },
                { value: 30, label: "最近30分钟" },
                { value: 60, label: "最近1小时" },
              ]}
            />
            <span className="muted-text">{formatTime(snapshot.time)}</span>
            <Button
              onClick={() => {
                void current.refetch();
                void history.refetch();
              }}
            >
              刷新
            </Button>
            {can("monitor:configure") && (
              <Button
                disabled={!policy.data}
                onClick={() => {
                  form.setFieldsValue(policy.data!);
                  setConfiguring(true);
                }}
              >
                告警设置
              </Button>
            )}
          </div>
          <div className="monitor-grid panel module-panel">
            <Statistic
              title="运行时长（小时）"
              value={snapshot.uptimeMs / 3600000}
              precision={1}
            />
            <Statistic
              title="CPU使用率"
              value={snapshot.cpuUsage < 0 ? "不可用" : snapshot.cpuUsage}
              precision={1}
              suffix={snapshot.cpuUsage < 0 ? undefined : "%"}
            />
            <Statistic
              title="堆内存使用率"
              value={
                snapshot.heapMax > 0
                  ? (snapshot.heapUsed * 100) / snapshot.heapMax
                  : 0
              }
              precision={1}
              suffix="%"
            />
            <Statistic
              title="数据库延迟"
              value={snapshot.databaseLatencyMs}
              suffix="ms"
            />
          </div>
          <QueryState
            loading={history.isLoading}
            error={history.error}
            retry={() => void history.refetch()}
          >
            <div className="monitor-charts">
              <section className="panel module-panel">
                <b>内存与CPU（%）</b>
                <div className="monitor-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} accessibilityLayer={false}>
                      <CartesianGrid
                        stroke="var(--app-border)"
                        strokeDasharray="3 3"
                      />
                      <XAxis dataKey="time" minTickGap={40} />
                      <YAxis domain={[0, 100]} width={38} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--app-panel)",
                          borderColor: "var(--app-border)",
                          color: "var(--app-text)",
                        }}
                      />
                      <Line
                        name="堆内存"
                        dataKey="heapPercent"
                        stroke="var(--app-chart-1)"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        name="CPU"
                        dataKey="cpuUsage"
                        stroke="var(--app-chart-2)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {!chartData.length && (
                  <span className="muted-text">
                    尚无历史采样，首次采样后显示。
                  </span>
                )}
              </section>
              <section className="panel module-panel">
                <b>数据库延迟（ms）</b>
                <div className="monitor-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} accessibilityLayer={false}>
                      <CartesianGrid
                        stroke="var(--app-border)"
                        strokeDasharray="3 3"
                      />
                      <XAxis dataKey="time" minTickGap={40} />
                      <YAxis width={38} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--app-panel)",
                          borderColor: "var(--app-border)",
                          color: "var(--app-text)",
                        }}
                      />
                      <Line
                        name="延迟"
                        dataKey="databaseLatencyMs"
                        stroke="var(--app-chart-1)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>
          </QueryState>
          <Descriptions
            className="panel module-panel"
            column={{ xs: 1, sm: 2, lg: 4 }}
            items={[
              {
                key: "database",
                label: "数据库",
                children: (
                  <Tag color={snapshot.database ? "success" : "error"}>
                    {snapshot.database ? "正常" : "连接失败"}
                  </Tag>
                ),
              },
              { key: "threads", label: "线程", children: snapshot.threads },
              {
                key: "heap",
                label: "堆内存",
                children: `${Math.round(snapshot.heapUsed / 1048576)} / ${Math.round(snapshot.heapMax / 1048576)} MB`,
              },
              { key: "cpu", label: "核心数", children: snapshot.processors },
              { key: "java", label: "Java", children: snapshot.javaVersion },
              { key: "os", label: "操作系统", children: snapshot.os },
              { key: "zone", label: "时区", children: snapshot.timezone },
              {
                key: "policy",
                label: "告警",
                children: policy.data?.enabled ? "已启用" : "未启用",
              },
            ]}
          />
        </div>
      )}
      <FormModal
        title="告警设置"
        open={configuring}
        form={form}
        onCancel={() => setConfiguring(false)}
        onSubmit={async (values) => {
          if (!policy.data) throw new Error("告警策略未加载");
          await saveMonitorPolicy({
            ...values,
            alertUserId: values.alertUserId ?? undefined,
            version: policy.data.version,
          });
          message.success("告警设置已保存");
          setConfiguring(false);
          await client.invalidateQueries({ queryKey: ["monitor-policy"] });
        }}
      >
        <Form.Item name="enabled" label="站内提醒" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="heapThresholdPercent"
          label="堆内存阈值（%）"
          rules={[{ required: true }]}
        >
          <InputNumber min={50} max={99} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="databaseThresholdMs"
          label="数据库延迟阈值（ms）"
          rules={[{ required: true }]}
        >
          <InputNumber min={10} max={60000} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="alertUserId"
          label="接收人"
          dependencies={["enabled"]}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value: number | null) {
                return getFieldValue("enabled") && !value
                  ? Promise.reject(new Error("启用提醒时请选择接收人"))
                  : Promise.resolve();
              },
            }),
          ]}
        >
          <Select
            allowClear
            loading={recipients.isLoading}
            options={recipients.data}
          />
        </Form.Item>
        <p className="muted-text">
          超出阈值时每30分钟最多提醒一次。数据库离线时无法向同一个数据库保存告警。
        </p>
      </FormModal>
    </QueryState>
  );
}
