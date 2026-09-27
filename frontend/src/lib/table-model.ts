export interface GroupedRow<T> {
  key: string;
  label: string;
  sequence: string;
  record?: T;
  children?: GroupedRow<T>[];
}

/**
 * 声明列宽是阅读偏好，不是表格的强制最小宽度。
 * 可用空间足够时保留偏好；不足时按各列可压缩量分摊，操作列等 minimum=preferred 的列不会被挤掉。
 * 只有连最小可读宽度也放不下时才横向滚动，避免把长文本或固定列宽直接变成默认滚动条。
 */
export function fitTableWidths(
  preferred: number[],
  minimum: number[],
  available: number,
) {
  const total = preferred.reduce((sum, width) => sum + width, 0);
  const minTotal = minimum.reduce((sum, width) => sum + width, 0);
  if (available >= total) return { widths: preferred, overflow: false };
  if (available < minTotal) return { widths: minimum, overflow: true };
  const fraction = (available - minTotal) / Math.max(1, total - minTotal);
  // 向下取整，把不足一像素的余量留给浏览器，避免列宽舍入反而产生一像素横向溢出。
  return {
    widths: preferred.map((width, index) =>
      Math.floor(minimum[index] + (width - minimum[index]) * fraction),
    ),
    overflow: false,
  };
}

/** 菜单目录遵循实际侧栏顺序；组名来自路由目录，不制造可提交的虚拟菜单 ID。 */
export function groupTableRows<
  T extends { id: string | number; sortOrder?: number },
>(records: T[], groupBy: (row: T) => string): GroupedRow<T>[] {
  const order = [
    "概览",
    "工作空间",
    "内容管理",
    "通知中心",
    "审批中心",
    "系统管理",
    "个人",
  ];
  const groups = new Map<string, T[]>();
  for (const row of records) {
    const group = groupBy(row);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => {
      const rank = (name: string) =>
        order.includes(name) ? order.indexOf(name) : order.length;
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map(([label, children], index) => ({
      key: `group:${label}`,
      label,
      sequence: String(index + 1),
      children: [...children]
        .sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
            String(a.id).localeCompare(String(b.id), undefined, {
              numeric: true,
            }),
        )
        .map((record, child) => ({
          key: `record:${record.id}`,
          label,
          record,
          sequence: `${index + 1}.${child + 1}`,
        })),
    }));
}
