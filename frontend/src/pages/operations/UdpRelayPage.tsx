import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  theme,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import dayjs from "dayjs";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { FormModal } from "../../components/FormModal";
import { QueryState } from "../../components/shared";
import type {
  RelayConfig,
  RelayStats,
  RelayInterface,
} from "../../types/relay";

/** 实时查询仅在页面挂载时存在；关闭页签不会停止服务器转发。配置表单独立保存，不随采样刷新覆盖。 */
export function UdpRelayPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<RelayConfig>();
  const [samples, setSamples] = useState<RelayStats[]>([]);
  const config = useQuery({
    queryKey: ["relay-config"],
    queryFn: () => api<RelayConfig>("/relay/config"),
  });
  const stats = useQuery({
    queryKey: ["relay-stats"],
    queryFn: () => api<RelayStats>("/relay/stats"),
    refetchInterval: 1000,
  });
  const data = stats.data;
  const interfaces = useQuery({
    queryKey: ["relay-interfaces"],
    queryFn: () => api<RelayInterface[]>("/relay/interfaces"),
    enabled: open,
    staleTime: 0,
  });
  const addressOptions = (interfaces.data ?? []).map((nic) => ({
    value: nic.ip,
    label: `${nic.ip} · ${nic.name}${nic.loopback ? "（回环）" : ""}${nic.up ? "" : "（已停用）"}`,
    disabled: !nic.up,
  }));
  const running = data?.state === "RUNNING";
  useEffect(() => {
    if (!data) return;
    setSamples((previous) => {
      const old = previous.at(-1);
      if (old?.runId === data.runId && old?.sampledAt === data.sampledAt)
        return previous;
      return old?.runId !== data.runId
        ? [data]
        : [...previous.slice(-59), data];
    });
  }, [data]);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["relay-config"] }),
      client.invalidateQueries({ queryKey: ["relay-stats"] }),
    ]);
  };
  const control = async (action: "start" | "stop") => {
    if (!config.data || !data || busy) return;
    setBusy(true);
    try {
      const next = await api<RelayStats>(`/relay/${action}`, {
        method: "POST",
        body: jsonBody(
          action === "start"
            ? { version: config.data.version }
            : { runId: data.runId },
        ),
      });
      client.setQueryData(["relay-stats"], next);
      message.success(action === "start" ? "转发已启动" : "转发已停止");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const discarded =
    (data?.invalidPackets ?? 0) +
    (data?.overflowPackets ?? 0) +
    (data?.sendFailures ?? 0);
  const number = (value?: number) =>
    (value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const buffer = (value?: number) =>
    value ? `${(value / 1024 / 1024).toFixed(1)} MiB` : "—";
  return (
    <QueryState
      loading={config.isLoading || stats.isLoading}
      error={config.error || stats.error}
      retry={() => void refresh()}
    >
      <div className="udp-relay-page">
        <section className="panel udp-relay-config">
          <div className="udp-relay-actions">
            <Space wrap>
              <Tag
                color={
                  running
                    ? "processing"
                    : data?.state === "FAILED"
                      ? "error"
                      : "default"
                }
              >
                {running
                  ? "运行中"
                  : data?.state === "FAILED"
                    ? "启动失败"
                    : "已停止"}
              </Tag>
              {data?.transport && <span>{data.transport}</span>}
              {data &&
                config.data &&
                data.actualReceiveBuffer > 0 &&
                data.actualReceiveBuffer <
                  config.data.receiveBufferMiB * 1024 * 1024 && (
                  <Tooltip
                    title={`系统仅提供 ${buffer(data.actualReceiveBuffer)} 接收缓冲，低于申请的 ${config.data.receiveBufferMiB} MiB；高流量时可能发生内核丢包，请调整部署环境的 socket 缓冲上限。`}
                  >
                    <Tag color="warning">接收缓冲受限</Tag>
                  </Tooltip>
                )}
              <span className="text-muted">第 3–4 字节：03 01</span>
            </Space>
            <Space>
              {can("relay:configure") && (
                <Button
                  disabled={running || busy || !config.data}
                  onClick={() => {
                    form.setFieldsValue(config.data!);
                    setOpen(true);
                  }}
                >
                  配置
                </Button>
              )}
              {can("relay:control") && (
                <Button
                  type="primary"
                  danger={running}
                  loading={busy}
                  disabled={!data || !config.data}
                  onClick={() => void control(running ? "stop" : "start")}
                >
                  {running ? "停止转发" : "启动转发"}
                </Button>
              )}
            </Space>
          </div>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, lg: 4 }}
            items={[
              {
                key: "receive",
                label: "接收地址",
                children: config.data
                  ? `${config.data.bindIp}:${config.data.bindPort}`
                  : "—",
              },
              {
                key: "target",
                label: "转发目标",
                children: config.data
                  ? `${config.data.targetIp}:${config.data.targetPort}`
                  : "—",
              },
              {
                key: "started",
                label: "启动时间",
                children: data?.startedAt
                  ? dayjs(data.startedAt).format("MM-DD HH:mm:ss")
                  : "—",
              },
              {
                key: "sample",
                label: "统计时间",
                children: data ? dayjs(data.sampledAt).format("HH:mm:ss") : "—",
              },
              {
                key: "actualBind",
                label: "实际监听",
                children: data?.boundAddress || "—",
              },
              {
                key: "actualSend",
                label: "实际发送源",
                children: data?.sendAddress || "—",
              },
              {
                key: "sender",
                label: "最近来包源",
                children: data?.lastSender || "—",
              },
            ]}
          />
        </section>
        {data?.lastError && (
          <Alert type="error" title={data.lastError} showIcon />
        )}
        <div className="udp-relay-metrics">
          <section className="panel">
            <Statistic title="已收包" value={data?.receivedPackets ?? 0} />
          </section>
          <section className="panel">
            <Statistic
              title={
                <Tooltip title="成功写入本机 UDP 发送 socket；对端接收仍需序号核对。">
                  已转发
                </Tooltip>
              }
              value={data?.forwardedPackets ?? 0}
            />
          </section>
          <section className="panel">
            <Statistic
              title={
                <Tooltip title="短包、待发送内存超限、发送失败及已知的本 socket 内核丢包。不包含无法观测的链路和对端丢包。">
                  本机已知丢包
                </Tooltip>
              }
              value={discarded + (data?.kernelDrops ?? 0)}
              styles={{
                content: {
                  color:
                    discarded + (data?.kernelDrops ?? 0) > 0
                      ? token.colorError
                      : undefined,
                },
              }}
            />
          </section>
          <section className="panel">
            <Statistic title="待发送" value={data?.pendingPackets ?? 0} />
          </section>
          <section className="panel">
            <Statistic
              title="接收速率"
              value={data?.receiveMbps ?? 0}
              precision={2}
              suffix="Mbps"
            />
          </section>
          <section className="panel">
            <Statistic
              title="转发速率"
              value={data?.forwardMbps ?? 0}
              precision={2}
              suffix="Mbps"
            />
          </section>
        </div>
        <div className="udp-relay-details">
          <section className="panel udp-relay-chart-panel">
            <div className="udp-relay-chart-heading">
              <strong>实时速率</strong>
              <span className="text-muted">
                UDP 负载 · Mbps · 最近 60 次采样
              </span>
            </div>
            <div className="udp-relay-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={samples}
                  margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke={token.colorBorderSecondary}
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="sampledAt"
                    tickFormatter={(value) => dayjs(value).format("HH:mm:ss")}
                    minTickGap={45}
                    tick={{ fill: token.colorTextSecondary, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: token.colorTextSecondary, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <ChartTooltip
                    labelFormatter={(value) =>
                      dayjs(String(value)).format("HH:mm:ss")
                    }
                    contentStyle={{
                      background: token.colorBgElevated,
                      borderColor: token.colorBorder,
                      borderRadius: token.borderRadius,
                    }}
                  />
                  <Legend />
                  <Line
                    name="接收"
                    dataKey="receiveMbps"
                    stroke={token.colorPrimary}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Line
                    name="转发"
                    dataKey="forwardMbps"
                    stroke={token.colorSuccess}
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="panel udp-relay-breakdown">
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "short",
                  label: "不足 8 字节丢弃",
                  children: number(data?.invalidPackets),
                },
                {
                  key: "queue",
                  label: "待发送内存超限",
                  children: number(data?.overflowPackets),
                },
                {
                  key: "sendfail",
                  label: "发送失败",
                  children: number(data?.sendFailures),
                },
                {
                  key: "kernel",
                  label: (
                    <Tooltip title="Linux 下读取本监听 socket 的丢包计数；不支持或无法读取时显示不可用。">
                      系统接收丢包
                    </Tooltip>
                  ),
                  children:
                    data?.kernelDrops == null
                      ? "不可用"
                      : number(data.kernelDrops),
                },
                {
                  key: "errors",
                  label: "接收异常",
                  children: number(data?.receiveErrors),
                },
                {
                  key: "pps",
                  label: "收包 / 转发（包/秒）",
                  children: `${number(data?.receivePps)} / ${number(data?.forwardPps)}`,
                },
                {
                  key: "loss",
                  label: "应用丢弃率",
                  children: `${data?.receivedPackets ? ((discarded / data.receivedPackets) * 100).toFixed(3) : "0.000"}%`,
                },
                {
                  key: "buffer",
                  label: "实际接收 / 发送缓冲",
                  children: `${buffer(data?.actualReceiveBuffer)} / ${buffer(data?.actualSendBuffer)}`,
                },
              ]}
            />
          </section>
        </div>
      </div>
      <FormModal
        title="UDP 转发配置"
        open={open}
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          await api("/relay/config", { method: "PUT", body: jsonBody(values) });
          setOpen(false);
          message.success("配置已保存");
          await refresh();
        }}
      >
        <Form.Item name="version" hidden>
          <Input />
        </Form.Item>
        <div className="form-two-columns">
          <Form.Item
            name="bindIp"
            label="接收 IP"
            rules={[{ required: true, message: "请输入服务器接收 IP" }]}
            tooltip="服务器本地网卡 IP；0.0.0.0 监听全部 IPv4 网卡。容器中填写容器网卡地址。"
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={interfaces.isFetching}
              options={[
                { value: "0.0.0.0", label: "全部 IPv4 地址（0.0.0.0）" },
                { value: "::", label: "全部 IPv6 地址（::）" },
                ...addressOptions,
              ]}
            />
          </Form.Item>
          <Form.Item
            name="bindPort"
            label="接收端口"
            rules={[{ required: true, message: "请输入接收端口" }]}
          >
            <InputNumber
              min={1024}
              max={65535}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="targetIp"
            label="目标 IP"
            rules={[{ required: true, message: "请输入单播目标 IP" }]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="targetPort"
            label="目标端口"
            rules={[{ required: true, message: "请输入目标端口" }]}
          >
            <InputNumber
              min={1}
              max={65535}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="sendIp"
            label="发送源 IP"
            tooltip="可独立选择本机外网/内网地址；绑定源 IP 不会替代操作系统路由，同网段多网卡仍需配置策略路由。"
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={interfaces.isFetching}
              options={[
                { value: "", label: "系统自动选择" },
                ...addressOptions,
              ]}
            />
          </Form.Item>
          <Form.Item
            name="sendPort"
            label="发送源端口"
            rules={[{ required: true }]}
            tooltip="0 为系统分配。与接收端口独立；单向转发不会自动处理下游回包。"
          >
            <InputNumber
              min={0}
              max={65535}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="transportMode"
            label="传输模式"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "AUTO", label: "自动（Linux 优先 EPOLL）" },
                { value: "NIO", label: "NIO（跨平台）" },
                { value: "EPOLL", label: "EPOLL（Linux）" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="receiveBufferMiB"
            label="申请接收缓冲（MiB）"
            rules={[{ required: true }]}
            tooltip="实际大小受操作系统上限约束，启动后可在页面查看。"
          >
            <InputNumber
              min={1}
              max={64}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="sendBufferMiB"
            label="申请发送缓冲（MiB）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={1}
              max={64}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="pendingMemoryMiB"
            label="待发送内存上限（MiB）"
            rules={[{ required: true }]}
            tooltip="发送拥塞时的内存保护；超限明确计数丢弃，避免无限排队耗尽内存。"
          >
            <InputNumber
              min={1}
              max={256}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </div>
        {interfaces.isError && (
          <Alert
            type="error"
            title="读取服务器网卡失败"
            action={
              <Button onClick={() => void interfaces.refetch()}>重试</Button>
            }
          />
        )}
      </FormModal>
    </QueryState>
  );
}
