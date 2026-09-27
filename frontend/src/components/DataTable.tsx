import { useLayoutEffect, useRef, useState } from "react";
import { Table, type TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { fitTableWidths } from "../lib/table-model";

/**
 * 全站表格入口：序号与分页同步，既支持服务端受控分页，也支持弹窗内本地分页。
 * 序号列不参与列显隐；筛选后按结果重新编号，不使用数据库 ID 充当展示序号。
 * 按实际容器测量列宽，弹窗、侧栏折叠及窗口缩放都自动重算，长文本不会撑开表格。
 */
export function DataTable<T extends object>({
  columns = [],
  pagination,
  onChange,
  className,
  sequence,
  ...props
}: TableProps<T> & {
  sequence?: (record: T, index: number) => React.ReactNode;
}) {
  const [localPage, setLocalPage] = useState(
    pagination === false ? 1 : (pagination?.defaultCurrent ?? 1),
  );
  const [localSize, setLocalSize] = useState(
    pagination === false ? 10 : (pagination?.defaultPageSize ?? 10),
  );
  const size = pagination === false ? 10 : (pagination?.pageSize ?? localSize);
  const total =
    pagination === false
      ? 0
      : (pagination?.total ?? props.dataSource?.length ?? 0);
  const page =
    pagination === false
      ? 1
      : (pagination?.current ??
        Math.min(localPage, Math.max(1, Math.ceil(total / size))));
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () =>
      setAvailable(Math.max(0, Math.floor(element.clientWidth) - 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const indexed: ColumnsType<T> = [
    {
      title: "序号",
      key: "__sequence",
      width: 56,
      align: "center",
      className: "table-sequence",
      render: (_, row, index) =>
        sequence?.(row, index) ?? (page - 1) * size + index + 1,
    },
    ...columns,
  ];
  const selectionWidth = props.rowSelection
    ? Number(props.rowSelection.columnWidth ?? 40)
    : 0;
  const preferred = indexed.map((column) =>
    typeof column.width === "number" ? column.width : 140,
  );
  const minimum = indexed.map((column, index) => {
    if (index === 0 || column.key === "actions" || column.title === "操作")
      return preferred[index];
    if ("minWidth" in column && typeof column.minWidth === "number")
      return Math.min(preferred[index], column.minWidth);
    return Math.min(
      preferred[index],
      index === 1
        ? 112
        : /时间|日期/.test(String(column.title))
          ? 120
          : preferred[index] <= 110
            ? 80
            : column.ellipsis
              ? 80
              : 84,
    );
  });
  const fitted = fitTableWidths(
    preferred,
    minimum,
    Math.max(0, available - selectionWidth),
  );
  const overflow = available > 0 && fitted.overflow;
  const adaptedColumns = indexed.map((column, index) => ({
    ...column,
    // 普通文本默认省略；复杂单元格仍由其 render 和业务样式处理。
    ellipsis:
      column.ellipsis ?? ("dataIndex" in column && column.dataIndex != null),
    width: available > 0 ? fitted.widths[index] : column.width,
    fixed: overflow ? column.fixed : undefined,
  }));
  return (
    <div ref={container} className="data-table-container">
      <Table<T>
        {...props}
        className={["data-table", className].filter(Boolean).join(" ")}
        tableLayout={props.tableLayout ?? "fixed"}
        columns={adaptedColumns}
        rowSelection={
          props.rowSelection
            ? { ...props.rowSelection, columnWidth: selectionWidth }
            : undefined
        }
        scroll={{
          ...props.scroll,
          x: overflow
            ? fitted.widths.reduce((sum, width) => sum + width, selectionWidth)
            : undefined,
        }}
        pagination={pagination}
        onChange={(next, filters, sorter, extra) => {
          setLocalPage(next.current ?? 1);
          setLocalSize(next.pageSize ?? 10);
          onChange?.(next, filters, sorter, extra);
        }}
      />
    </div>
  );
}
