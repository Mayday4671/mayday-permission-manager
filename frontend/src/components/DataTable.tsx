import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Checkbox,
  Empty,
  Pagination,
  Spin,
  Table,
  type TableProps,
} from "antd";
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
  onColumnResize,
  onColumnReorder,
  "aria-label": accessibleName,
  ...props
}: TableProps<T> & {
  sequence?: (record: T, index: number) => React.ReactNode;
  /** 列尺寸与顺序由页面偏好层保存，不把展示参数提交到业务接口。 */
  onColumnResize?: (key: string, width: number) => void;
  onColumnReorder?: (source: string, target: string) => void;
  "aria-label"?: string;
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
  type HeaderColumn = Parameters<
    NonNullable<ColumnsType<T>[number]["onHeaderCell"]>
  >[0];
  const adaptedColumns = indexed.map((column, index) => ({
    ...column,
    // 尺寸手柄有独立可访问名称，表头仍只报告业务列名，避免读屏将两个名称连读。
    onHeaderCell: (headerColumn: HeaderColumn) => ({
      ...column.onHeaderCell?.(headerColumn),
      ...(typeof column.title === "string"
        ? { "aria-label": column.title }
        : {}),
    }),
    // 普通文本默认省略；复杂单元格仍由其 render 和业务样式处理。
    ellipsis:
      column.ellipsis ?? ("dataIndex" in column && column.dataIndex != null),
    width: available > 0 ? fitted.widths[index] : column.width,
    fixed: overflow ? column.fixed : undefined,
    title:
      index === 0 || column.key === "actions" || !onColumnResize ? (
        column.title
      ) : (
        <span
          className="table-column-title"
          draggable={Boolean(onColumnReorder)}
          onDragStart={(event) => {
            event.dataTransfer.setData(
              "text/x-mayday-column",
              String(column.key),
            );
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("text/x-mayday-column"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData("text/x-mayday-column");
            if (!source) return;
            event.preventDefault();
            onColumnReorder?.(source, String(column.key));
          }}
        >
          {typeof column.title === "function" ? column.title({}) : column.title}
          <span
            className="table-column-resize"
            role="separator"
            tabIndex={0}
            aria-label={`调整${String(column.title)}列宽`}
            aria-orientation="vertical"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              onColumnResize(
                String(column.key),
                preferred[index] + (event.key === "ArrowRight" ? 16 : -16),
              );
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const initialX = event.clientX;
              const initialWidth =
                available > 0 ? fitted.widths[index] : preferred[index];
              const move = (pointer: PointerEvent) =>
                onColumnResize(
                  String(column.key),
                  initialWidth + pointer.clientX - initialX,
                );
              const stop = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", stop);
                window.removeEventListener("pointercancel", stop);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", stop, { once: true });
              window.addEventListener("pointercancel", stop, { once: true });
            }}
          />
        </span>
      ),
  }));
  // 手机窄屏以同一授权列渲染卡片，序号、勾选与业务动作全部保留；层级表继续使用展开行。
  const mobileCards = available > 0 && available < 640 && !props.expandable;
  const records = props.dataSource ?? [];
  const mobileRecords =
    pagination !== false && records.length > size
      ? records.slice((page - 1) * size, page * size)
      : records;
  const selected = props.rowSelection?.selectedRowKeys ?? [];
  const rowKey = (record: T, index: number) =>
    typeof props.rowKey === "function"
      ? props.rowKey(record)
      : ((record as Record<string, React.Key>)[String(props.rowKey ?? "key")] ??
        index);
  const cell = (
    column: (typeof columns)[number],
    record: T,
    index: number,
  ): ReactNode => {
    const path = "dataIndex" in column ? column.dataIndex : undefined;
    const value = (
      Array.isArray(path) ? path : path == null ? [] : [path]
    ).reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[String(key)]
          : undefined,
      record,
    );
    const rendered = column.render
      ? column.render(value, record, index)
      : value;
    if (
      rendered &&
      typeof rendered === "object" &&
      "props" in rendered &&
      "children" in rendered
    )
      return rendered.children as ReactNode;
    return rendered as ReactNode;
  };
  return (
    <div ref={container} className="data-table-container">
      {mobileCards ? (
        <Spin
          spinning={
            typeof props.loading === "boolean"
              ? props.loading
              : (props.loading?.spinning ?? false)
          }
        >
          <div
            className="table-mobile-cards"
            role="list"
            aria-label={accessibleName ?? "数据列表"}
          >
            {!mobileRecords.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无数据"
              />
            )}
            {mobileRecords.map((record, index) => {
              const key = rowKey(record, index);
              const checkbox = props.rowSelection?.getCheckboxProps?.(record);
              return (
                <article
                  className="table-mobile-card"
                  role="listitem"
                  key={key}
                >
                  <div className="table-mobile-card-top">
                    <span className="muted">
                      序号{" "}
                      {sequence?.(record, index) ??
                        (page - 1) * size + index + 1}
                    </span>
                    {props.rowSelection && (
                      <Checkbox
                        {...checkbox}
                        checked={selected.includes(key)}
                        aria-label={`选择第${(page - 1) * size + index + 1}条记录`}
                        onChange={(event) => {
                          const keys = event.target.checked
                            ? [...selected, key]
                            : selected.filter((item) => item !== key);
                          const rows = records.filter((item, itemIndex) =>
                            keys.includes(rowKey(item, itemIndex)),
                          );
                          props.rowSelection?.onChange?.(keys, [...rows], {
                            type: "single",
                          });
                        }}
                      />
                    )}
                  </div>
                  <dl>
                    {columns.map((column, columnIndex) => (
                      <div key={String(column.key ?? columnIndex)}>
                        <dt>
                          {typeof column.title === "function"
                            ? column.title({})
                            : column.title}
                        </dt>
                        <dd>{cell(column, record, index) ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
          {pagination !== false && (
            <Pagination
              {...pagination}
              current={page}
              pageSize={size}
              total={total}
              onChange={(nextPage, nextSize) => {
                setLocalPage(nextPage);
                setLocalSize(nextSize);
                pagination?.onChange?.(nextPage, nextSize);
                onChange?.(
                  { current: nextPage, pageSize: nextSize, total },
                  {},
                  {},
                  { currentDataSource: [...records], action: "paginate" },
                );
              }}
            />
          )}
        </Spin>
      ) : (
        <Table<T>
          {...props}
          aria-label={accessibleName}
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
              ? fitted.widths.reduce(
                  (sum, width) => sum + width,
                  selectionWidth,
                )
              : undefined,
          }}
          pagination={pagination}
          onChange={(next, filters, sorter, extra) => {
            setLocalPage(next.current ?? 1);
            setLocalSize(next.pageSize ?? 10);
            onChange?.(next, filters, sorter, extra);
          }}
        />
      )}
    </div>
  );
}
