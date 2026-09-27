import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  FolderTree,
  ShieldCheck,
  Users,
} from "lucide-react";
import dayjs from "dayjs";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PersonalWorkPanel } from "../components/PersonalWorkPanel";
import type { DashboardData } from "../types";
import {
  CategoryTag,
  formatTime,
  PersonAvatar,
  QueryState,
  SectionTitle,
} from "../components/shared";

/** 真实工作台，指标遵循当前用户权限。初始空审计历史明确展示零值，不使用演示增长率。 */
export function DashboardPage() {
  const { can } = useAuth();
  // 没有查看权限的模块不生成卡片，避免以“未授权”空态占据首页空间。
  const showLogs = can("logs:view");
  const showContent = can("notices:view");
  const showWork =
    can("messages:view") || (can("requests:view") && can("requests:approve"));
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/dashboard"),
  });
  const data = query.data;
  const stats = [
    {
      label: "用户总数",
      value: data?.users,
      icon: Users,
      color: "purple",
      path: "/admin/users",
      note: "查看用户",
      unit: "位",
    },
    {
      label: "权限角色",
      value: data?.roles,
      icon: ShieldCheck,
      color: "blue",
      path: "/admin/roles",
      note: "查看角色",
      unit: "个",
    },
    {
      label: "组织部门",
      value: data?.departments,
      icon: FolderTree,
      color: "orange",
      path: "/admin/departments",
      note: "查看部门",
      unit: "个",
    },
    {
      label: "内容总数",
      value: data?.notices,
      icon: FileText,
      color: "green",
      path: "/admin/notices",
      note: `已发布 ${data?.published ?? 0} 篇内容`,
      unit: "篇",
    },
  ].filter((s) => s.value !== null);
  const quick = [
    {
      label: "用户管理",
      icon: Users,
      path: "users",
      color: "purple",
    },
    {
      label: "角色权限",
      icon: ShieldCheck,
      path: "roles",
      color: "blue",
    },
    {
      label: "内容中心",
      icon: FileText,
      path: "notices",
      color: "orange",
    },
    {
      label: "组织部门",
      icon: FolderTree,
      path: "departments",
      color: "green",
    },
  ].filter((q) => can(`${q.path}:view`));
  return (
    <div className="dashboard-page">
      {/* 页面名称由面包屑/标签页提供；正文直接呈现数据，刷新复用标签栏按钮。 */}
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      >
        <div className="stat-grid">
          {stats.map((s) => (
            <Link to={s.path} className="stat-card" key={s.label}>
              <div className="stat-top">
                <span>{s.label}</span>
                <span className={`metric-icon ${s.color}`}>
                  <s.icon size={19} />
                </span>
              </div>
              <div className="stat-value">
                {s.value ?? "—"}
                <small>{s.unit}</small>
              </div>
            </Link>
          ))}
        </div>
        {(showLogs || showWork || quick.length > 0) && (
          <div
            className={`dashboard-middle ${showLogs && (showWork || quick.length > 0) ? "" : "single-panel"}`}
          >
            {showLogs && (
              <section className="panel activity-chart">
                <SectionTitle
                  title="操作统计"
                  subtitle="最近 7 天"
                  extra={
                    <span className="chart-legend">
                      <i />
                      {data?.trend.reduce((s, v) => s + v.count, 0) ?? 0} 次操作
                    </span>
                  }
                />
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data?.trend}
                      margin={{ top: 15, right: 12, bottom: 0, left: -26 }}
                    >
                      <defs>
                        <linearGradient
                          id="activityFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--app-primary)"
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--app-primary)"
                            stopOpacity={0.01}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--app-border)"
                        strokeDasharray="4 4"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => dayjs(v).format("MM/DD")}
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fill: "var(--app-text-secondary)",
                          fontSize: 11,
                        }}
                        dy={10}
                      />
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fill: "var(--app-text-secondary)",
                          fontSize: 11,
                        }}
                      />
                      <Tooltip
                        labelFormatter={(v) =>
                          dayjs(String(v)).format("M 月 D 日")
                        }
                        formatter={(v) => [v, "操作次数"]}
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid var(--app-border)",
                          background: "var(--app-elevated)",
                          color: "var(--app-text)",
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="var(--app-primary)"
                        strokeWidth={2.5}
                        fill="url(#activityFill)"
                        dot={{
                          fill: "var(--app-surface)",
                          strokeWidth: 2,
                          r: 3,
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
            {showWork && <PersonalWorkPanel />}
            {!showWork && quick.length > 0 && (
              <section className="panel quick-panel">
                <SectionTitle
                  title="快捷入口"
                  extra={
                    <span className="subtle-plus">{quick.length} 个入口</span>
                  }
                />
                <div className="quick-grid">
                  {quick.map((q) => (
                    <Link to={`/admin/${q.path}`} key={q.path}>
                      <span className={`metric-icon ${q.color}`}>
                        <q.icon size={21} />
                      </span>
                      <b>{q.label}</b>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {(showContent || showLogs) && (
          <div
            className={`dashboard-bottom ${showContent && showLogs ? "" : "single-panel"}`}
          >
            {showContent && (
              <section className="panel recent-content">
                <SectionTitle
                  title="最近内容"
                  extra={
                    can("notices:view") && (
                      <Link to="/admin/notices" className="text-link">
                        查看全部 <ArrowRight size={14} />
                      </Link>
                    )
                  }
                />
                {data?.recentNotices.length ? (
                  data.recentNotices.map((n, i) => (
                    <Link
                      to={n.published ? `/articles/${n.id}` : "/admin/notices"}
                      className="content-row"
                      key={n.id}
                    >
                      <span className={`content-thumb thumb-${i % 3}`}>
                        <FileText size={22} />
                      </span>
                      <div>
                        <strong>{n.title}</strong>
                        <span>
                          <CategoryTag value={n.category} />
                          <small>
                            {dayjs(n.createdAt).format("MM-DD")} ·{" "}
                            {n.authorName}
                          </small>
                        </span>
                      </div>
                      <span
                        className={`content-state ${n.published ? "" : "draft"}`}
                      >
                        {n.published ? "已发布" : "草稿"}
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                  ))
                ) : (
                  <div className="dashboard-empty">暂无内容</div>
                )}
              </section>
            )}
            {showLogs && (
              <section className="panel recent-activity">
                <SectionTitle
                  title="最近操作"
                  extra={
                    can("logs:view") && (
                      <Link to="/admin/logs" className="text-link">
                        全部 <ArrowRight size={14} />
                      </Link>
                    )
                  }
                />
                <div className="activity-list">
                  {data?.recentLogs.length ? (
                    data.recentLogs.slice(0, 4).map((log) => (
                      <div className="activity-item" key={log.id}>
                        <PersonAvatar
                          name={
                            log.username === "anonymous" ? "访" : log.username
                          }
                          size={30}
                        />
                        <div>
                          <p>
                            <b>
                              {log.username === "anonymous"
                                ? "登录请求"
                                : log.username}
                            </b>
                            <span>
                              {log.status < 400 ? "完成了操作" : "操作被拒绝"}
                            </span>
                          </p>
                          <span className="activity-path">
                            {log.method} {log.path.replace("/api/", "")}
                          </span>
                          <small>{formatTime(log.createdAt)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="dashboard-empty">暂无操作记录</div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
