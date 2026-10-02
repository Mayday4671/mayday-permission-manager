import { csvCell } from "./export";

/** 文件由已授权的当前展示列构建；禁止从整个业务实体推断导出字段。 */
export function downloadText(
  name: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 从表格/移动卡片提取当前页可见文本，移除勾选与操作按钮，隐藏字段不会进入导出。 */
export function visibleTableRows(container: HTMLElement): string[][] {
  const table = container.querySelector(".ant-table");
  if (table) {
    const head = [...table.querySelectorAll("thead th")];
    const included = head
      .map((cell, index) => ({ cell, index }))
      .filter(
        ({ cell }) =>
          !cell.classList.contains("ant-table-selection-column") &&
          cell.textContent?.trim() !== "操作",
      );
    const rows = [...table.querySelectorAll("tbody tr.ant-table-row")];
    return [
      included.map(({ cell }) => cell.textContent?.trim() ?? ""),
      ...rows.map((row) =>
        included.map(
          ({ index }) => row.children[index]?.textContent?.trim() ?? "",
        ),
      ),
    ];
  }
  const cards = [...container.querySelectorAll(".table-mobile-card")];
  if (!cards.length) return [];
  const labels = [...cards[0].querySelectorAll("dt")].map(
    (cell) => cell.textContent?.trim() ?? "",
  );
  return [
    ["序号", ...labels.filter((label) => label !== "操作")],
    ...cards.map((card) => [
      card
        .querySelector(".table-mobile-card-top span")
        ?.textContent?.replace("序号 ", "") ?? "",
      ...[...card.querySelectorAll("dd")]
        .filter((_, index) => labels[index] !== "操作")
        .map((cell) => cell.textContent?.trim() ?? ""),
    ]),
  ];
}

/** 输出 CSV 统一抵御电子表格公式执行，打印页面只拼接经过转义的可见文本。 */
export function exportVisibleTable(container: HTMLElement, title: string) {
  const rows = visibleTableRows(container);
  downloadText(
    `${title}-当前页.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
  );
}

/** 使用用户主动点击打开浏览器打印窗口；不包含登录令牌、原始实体或交互按钮。 */
export function printVisibleTable(container: HTMLElement, title: string) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const rows = visibleTableRows(container);
  popup.document.write(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:14px sans-serif;padding:20px;color:#222}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left;word-break:break-word}th{background:#f5f5f5}@page{size:landscape;margin:12mm}</style></head><body><h1>${escape(title)}</h1><table>${rows.map((row, index) => `<tr>${row.map((cell) => `<${index === 0 ? "th" : "td"}>${escape(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table></body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}
