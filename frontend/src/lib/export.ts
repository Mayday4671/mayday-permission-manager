import { api, queryString } from "./api";
import type { PageResult } from "../types";

/** CSV 统一处理引号、换行和电子表格公式注入；各业务只定义列和服务端受权限保护的导出地址。 */
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
export async function exportCsv<T>({
  endpoint,
  params,
  headers,
  row,
  name,
}: {
  endpoint: string;
  params: Record<string, unknown>;
  headers: string[];
  row: (item: T) => unknown[];
  name: string;
}) {
  const items: T[] = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total) {
    const result = await api<PageResult<T>>(
      `${endpoint}?${queryString({ ...params, page, size: undefined })}`,
    );
    items.push(...result.items);
    total = result.total;
    if (!result.items.length) break;
    page++;
  }
  const csv = [headers, ...items.map(row)]
    .map((values) => values.map(csvCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
