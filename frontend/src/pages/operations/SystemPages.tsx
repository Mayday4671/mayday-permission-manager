import {
  App,
  Button,
  Descriptions,
  Popconfirm,
  Progress,
  Statistic,
  Tag,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";

import { QueryState, formatTime } from "../../components/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { SessionRecord } from "../../types/operations";

export function SessionsPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  return (
    <ResourcePage<SessionRecord>
      resource="sessions"
      endpoint="/operations/sessions"
      title="在线用户"
      singular="用户"
      readOnly
      fields={() => null}
      columns={[
        {
          title: "用户",
          width: 170,
          render: (_, r) => (
            <span>
              {r.nickname} {r.current && <Tag color="blue">当前会话</Tag>}
              <small className="block-muted">{r.username}</small>
            </span>
          ),
        },
        { title: "登录 IP", dataIndex: "ip", width: 130 },
        {
          title: "浏览器 / 设备",
          dataIndex: "device",
          ellipsis: true,
          width: 300,
        },
        {
          title: "登录时间",
          dataIndex: "createdAt",
          render: formatTime,
          width: 180,
        },
        {
          title: "最后活跃",
          dataIndex: "lastActiveAt",
          render: formatTime,
          width: 180,
        },
        {
          title: "失效时间",
          dataIndex: "expiresAt",
          render: formatTime,
          width: 180,
        },
      ]}
      extraActions={(r, refresh) =>
        can("sessions:revoke") && (
          <Popconfirm
            title="强制该会话下线？"
            description={r.current ? "当前页面也会退出登录。" : undefined}
            onConfirm={async () => {
              try {
                await api("/operations/sessions/" + r.id, { method: "DELETE" });
                message.success("会话已撤销");
                refresh();
              } catch (e) {
                message.error((e as Error).message);
              }
            }}
          >
            <Button type="link" danger>
              下线
            </Button>
          </Popconfirm>
        )
      }
    />
  );
}
interface Monitor {
  time: string;
  uptimeMs: number;
  javaVersion: string;
  processors: number;
  threads: number;
  heapUsed: number;
  heapMax: number;
  heapCommitted: number;
  database: boolean;
  databaseLatencyMs: number;
  os: string;
  timezone: string;
}
export function MonitorPage() {
  const query = useQuery({
    queryKey: ["monitor"],
    queryFn: () => api<Monitor>("/operations/monitor"),
    refetchInterval: 10000,
  });
  const d = query.data;
  const mb = (v: number) => Math.round(v / 1048576);
  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      retry={() => void query.refetch()}
    >
      <div className="panel module-panel">
        {d && (
          <>
            <div className="monitor-grid">
              <Statistic
                title="已运行（小时）"
                value={d.uptimeMs / 3600000}
                precision={1}
              />
              <Statistic title="处理器核心" value={d.processors} />
              <Statistic title="当前线程" value={d.threads} />
              <Statistic title="数据库延迟（ms）" value={d.databaseLatencyMs} />
            </div>
            <Descriptions
              bordered
              column={{ xs: 1, sm: 2 }}
              items={[
                {
                  key: "db",
                  label: "数据库",
                  children: (
                    <Tag color={d.database ? "green" : "red"}>
                      {d.database ? "连接正常" : "连接失败"}
                    </Tag>
                  ),
                },
                { key: "java", label: "Java", children: d.javaVersion },
                { key: "os", label: "操作系统", children: d.os },
                { key: "zone", label: "时区", children: d.timezone },
                {
                  key: "time",
                  label: "采样时间",
                  children: formatTime(d.time),
                },
              ]}
            />
            <div className="heap-usage">
              <b>JVM 堆内存</b>
              <span>
                {mb(d.heapUsed)} / {mb(d.heapMax)} MB
              </span>
              <Progress percent={Math.round((d.heapUsed / d.heapMax) * 100)} />
            </div>
          </>
        )}
      </div>
    </QueryState>
  );
}
