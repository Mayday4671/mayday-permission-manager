/** 浏览器中的配置视为不可信输入；只恢复已知展示字段，不存储表格记录、表单或权限。 */
export type Density = "small" | "middle" | "large";
export function readPageSize(value: unknown): number {
  return value === 20 || value === 50 ? value : 10;
}
export function readDensity(value: unknown): Density {
  return value === "small" || value === "large" ? value : "middle";
}
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
