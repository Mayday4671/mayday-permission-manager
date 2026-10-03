/** 门户地址独立于页面组件，便于复用、测试以及校验文章详情的返回目标。 */
export const categoryHref = (id: number) => `/categories/${id}`;

/** 稳定栏目编码使用专用路由段；分类查询仅属于该栏目，不改变主导航。 */
export const channelHref = (code: string, categoryId?: number) =>
  `/channels/${encodeURIComponent(code)}${categoryId ? `?category=${categoryId}` : ""}`;

/** 门户与后台主题边界使用同一地址白名单；未知后台路由不能继承访客的暗夜偏好。 */
export function isPortalPath(path: string) {
  return path === "/" || /^\/(articles|categories|channels)\/[^/]+$/.test(path);
}

/** URL 参数只接受十进制正整数，防止无效栏目悄悄退化成“全部内容”。 */
export function positiveInteger(
  value: string | null | undefined,
  fallback?: number,
) {
  if (!value || !/^[1-9]\d*$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 2147483647
    ? number
    : fallback;
}

/** 仅允许本站首页、栏目页及其查询参数。拒绝外站、后台、反斜线和路径穿越。 */
export function portalReturnPath(state: unknown): string {
  const from =
    state && typeof state === "object" && "from" in state ? state.from : null;
  if (typeof from !== "string" || /[\\\r\n]/.test(from)) return "/";
  const pathname = from.split(/[?#]/, 1)[0];
  if (pathname === "/") return from;
  if (/^\/channels\/[a-z][a-z0-9-]{0,47}$/.test(pathname)) return from;
  const match = /^\/categories\/([1-9]\d*)$/.exec(pathname);
  return match && positiveInteger(match[1]) ? from : "/";
}

/** 旧书签迁移到栏目页；只携带仍有意义的搜索、标签和页码，不保留 category 筛选开关。 */
export function legacyCategoryHref(search: string): string | null {
  const source = new URLSearchParams(search);
  if (!source.has("category")) return null;
  const id = positiveInteger(source.get("category"));
  const params = new URLSearchParams();
  for (const key of ["q", "tag", "page"]) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `${id ? categoryHref(id) : "/categories/unavailable"}${query ? `?${query}` : ""}`;
}
