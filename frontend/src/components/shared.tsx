import type { ReactNode } from "react";
import { Alert, Button, Empty, Skeleton, Tag, Tooltip } from "antd";
import { ArrowUpRight, Crown, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";
import dayjs from "dayjs";

/** 全站品牌，后台侧栏、登录和前台共用。 */
export function Brand({
  light = false,
  name = "mayday",
}: {
  light?: boolean;
  name?: string;
}) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">
        <Crown size={23} strokeWidth={2.2} />
      </span>
      <span>
        {name}
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
/** 仅用于有实际内容分区的标题与工具栏，后台整页标题由面包屑和页签承担。 */
export function SectionTitle({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {extra}
    </div>
  );
}
/** 按钮级展示控制。它改善操作体验；真正安全边界始终是后端接口授权。 */
export function Permission({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(value) ? <>{children}</> : null;
}
/** 状态颜色和文字共同传达启停，调用方可替换业务术语，不能只靠颜色辨识状态。 */
export function StatusTag({
  enabled,
  activeText = "启用",
  inactiveText = "停用",
}: {
  enabled: boolean;
  activeText?: string;
  inactiveText?: string;
}) {
  return (
    <span className={`status-tag ${enabled ? "is-active" : ""}`}>
      <i />
      {enabled ? activeText : inactiveText}
    </span>
  );
}
/** 未配置头像时使用姓名首字符和稳定配色；不向外站请求头像或暴露用户身份。 */
export function PersonAvatar({
  name,
  size = 36,
}: {
  name: string;
  size?: number;
}) {
  const palette = ["lavender", "peach", "mint", "blue"];
  const color = palette[(name.codePointAt(0) ?? 0) % palette.length];
  return (
    <span
      className={`person-avatar ${color}`}
      style={{ width: size, height: size, fontSize: size / 2.6 }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
/** 所有异步区域都具备加载、失败和空态，失败时保留可重试入口。 */
export function QueryState({
  loading,
  error,
  retry,
  children,
  empty = false,
}: {
  loading: boolean;
  error?: Error | null;
  retry?: () => void;
  children: ReactNode;
  empty?: boolean;
}) {
  if (loading)
    return (
      <div className="panel state-panel">
        <Skeleton active paragraph={{ rows: 5 }} />
      </div>
    );
  if (error)
    return (
      <Alert
        type="error"
        showIcon
        title="暂时无法加载"
        description={error.message}
        action={<Button onClick={retry}>重试</Button>}
      />
    );
  if (empty)
    return (
      <div className="panel state-panel">
        <Empty description="暂无数据" />
      </div>
    );
  return <>{children}</>;
}
/** 带可访问名称的列表刷新操作，旋转图标表示后台同步但不清空已有结果。 */
export function RefreshButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <Tooltip title="刷新数据">
      <Button
        aria-label="刷新数据"
        icon={<RefreshCw size={16} className={loading ? "spinning" : ""} />}
        onClick={onClick}
      />
    </Tooltip>
  );
}
/** 统一人类可读的服务端时间格式，空值或无效日期显示占位而非 Invalid Date。 */
export const formatTime = (value: string | null | undefined) =>
  value && dayjs(value).isValid()
    ? dayjs(value).format("YYYY-MM-DD HH:mm")
    : "—";
/** 分类保留实际后台名称，并用常见类别配色辅助识别；未知类别仍可展示。 */
export function CategoryTag({ value }: { value: string }) {
  return (
    <Tag
      color={
        value === "公告"
          ? "orange"
          : value === "产品动态"
            ? "purple"
            : value === "团队故事"
              ? "cyan"
              : "blue"
      }
      variant="filled"
    >
      {value}
    </Tag>
  );
}
/** 导航提示的纯展示组合，具体链接地址和点击权限由调用方提供，不自行推断入口。 */
export function ArrowLink({ children }: { children: ReactNode }) {
  return (
    <span className="arrow-link">
      {children}
      <ArrowUpRight size={15} />
    </span>
  );
}
