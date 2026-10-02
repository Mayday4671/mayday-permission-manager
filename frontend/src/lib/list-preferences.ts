/** 浏览器中的配置视为不可信输入；只恢复已知展示字段，不存储表格记录、表单或权限。 */
export type Density = "small" | "middle" | "large";
/** 兼容旧列表的默认 10 行读取；新列表使用 nullable 偏好区分自动适配与主动选择。 */
export function readPageSize(value: unknown): number {
  return readPageSizePreference(value) ?? 10;
}
/** 未设置偏好返回 null，保留自动适配；只有用户主动选择的安全档位才写入持久偏好。 */
export function readPageSizePreference(value: unknown): number | null {
  return typeof value === "number" && [1, 3, 5, 10, 20, 50].includes(value)
    ? value
    : null;
}
/** 仅接受紧凑/标准/宽松三档，损坏或过期存储回退标准密度。 */
export function readDensity(value: unknown): Density {
  return value === "small" || value === "large" ? value : "middle";
}
/** 隐藏列只存有界去重的展示键，当前可用列仍由页面权限和业务配置重新决定。 */
export function readHiddenColumns(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === "string" && item.length < 150,
          ),
        ),
      ].slice(0, 80)
    : [];
}
/** 展示偏好按账号、路由、组件命名空间隔离，账号切换不会恢复其他人的列配置。 */
export function preferenceKey(
  userId: number | string,
  path: string,
  name: string,
) {
  return `mayday.preferences.v1.${JSON.stringify([userId, path, name])}`;
}

export type FilterValue = string | number | boolean;
export interface SavedQuery {
  id: string;
  name: string;
  keyword: string;
  status?: boolean;
  extra: Record<string, FilterValue>;
}
export const savedQueryLimit = 8;
/** 仅允许业务显式登记的筛选字段，忽略伪造的接口、页码、权限、数据范围等字段。 */
export function readSavedQueries(
  value: unknown,
  allowedKeys: readonly string[],
): SavedQuery[] {
  if (!Array.isArray(value)) return [];
  const result: SavedQuery[] = [];
  for (const entry of value.slice(0, 50)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 80 ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      result.some((item) => item.id === entry.id)
    )
      continue;
    const extra: Record<string, FilterValue> = {};
    for (const key of allowedKeys) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      const v: unknown = entry.extra?.[key];
      if (
        (typeof v === "string" && v.length <= 200) ||
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v))
      )
        extra[key] = v;
    }
    result.push({
      id: entry.id,
      name: entry.name.trim().slice(0, 24),
      keyword:
        typeof entry.keyword === "string"
          ? entry.keyword.trim().slice(0, 200)
          : "",
      status: typeof entry.status === "boolean" ? entry.status : undefined,
      extra,
    });
    if (result.length === savedQueryLimit) break;
  }
  return result;
}

/** 总数缩减后一次跳到合法页，避免从第几十页逐页请求空结果。 */
export function validPage(page: number, size: number, total: number) {
  return Math.min(
    Math.max(1, page),
    Math.max(1, Math.ceil(total / Math.max(1, size))),
  );
}
