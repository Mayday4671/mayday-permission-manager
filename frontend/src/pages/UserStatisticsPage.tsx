import { DataTable } from "../components/DataTable";
import { Segmented, Statistic, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { QueryState, RefreshButton } from "../components/shared";
import { usePageState } from "../lib/workspace";

interface Statistics {
  total: number;
  enabled: number;
  disabled: number;
  newUsers: number;
  activeUsers: number;
  loginSuccess: number;
  loginFailure: number | null;
  from: string;
  to: string;
  timezone: string;
  trend: { date: string; newUsers: number; logins: number }[];
}
/** 指标和每日明细来自同一授权范围，窗口口径可见；无全局失败日志权时不显示伪造的零。 */
export function UserStatisticsPage() {
  const [days, setDays] = usePageState("statistics.days", 7);
  const query = useQuery({
    queryKey: ["user-statistics", days],
    queryFn: () => api<Statistics>(`/system/user-statistics?days=${days}`),
  });
  const data = query.data;
  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      retry={() => void query.refetch()}
    >
      <section className="panel module-panel">
        <div className="module-toolbar">
          <Segmented
            value={days}
            onChange={(value) => setDays(Number(value))}
            options={[
              { value: 7, label: "近 7 天" },
              { value: 30, label: "近 30 天" },
              { value: 90, label: "近 90 天" },
            ]}
          />
          <RefreshButton
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          />
        </div>
        <div className="statistics-grid">
          {[
            ["账号总数", data?.total],
            ["启用账号", data?.enabled],
            ["停用账号", data?.disabled],
            ["新增账号", data?.newUsers],
            ["活跃账号", data?.activeUsers],
            ["成功登录次数", data?.loginSuccess],
            ...(data?.loginFailure != null
              ? [["失败登录次数", data.loginFailure]]
              : []),
          ].map(([title, value]) => (
            <Statistic
              key={String(title)}
              title={
                title === "活跃账号" ? (
                  <Tooltip
                    title="所选时间内成功登录过的现存账号，按账号去重。"
                    trigger={["hover", "focus"]}
                  >
                    <span tabIndex={0}>{title}</span>
                  </Tooltip>
                ) : (
                  title
                )
              }
              value={value ?? "—"}
            />
          ))}
        </div>
        <p className="statistics-definition">
          统计时间：{data?.from} 至 {data?.to}（{data?.timezone}）
        </p>
        <DataTable
          rowKey="date"
          size="middle"
          dataSource={data?.trend}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: "日期", dataIndex: "date" },
            { title: "新增账号", dataIndex: "newUsers" },
            { title: "成功登录次数", dataIndex: "logins" },
          ]}
        />
      </section>
    </QueryState>
  );
}
