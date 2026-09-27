import {
  isValidElement,
  useMemo,
  useState,
  type Key,
  type ReactNode,
} from "react";
import { Button, Space, type TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DataTable } from "./DataTable";
import { groupTableRows, type GroupedRow } from "../lib/table-model";

/** 分组行只承载展示，不冒充业务记录：编辑、删除、状态等回调只会收到真实子行。 */
export function GroupedDataTable<T extends { id: string | number }>({
  rows,
  columns,
  groupBy,
  loading,
  size,
}: {
  rows: T[];
  columns: ColumnsType<T>;
  groupBy: (row: T) => string;
  loading: boolean;
  size: TableProps<T>["size"];
}) {
  const tree = useMemo(() => groupTableRows(rows, groupBy), [rows, groupBy]);
  const [expanded, setExpanded] = useState<Key[]>([]);
  // 初次进入全部折叠；查询刷新也不擅自展开，只由用户点击目录或“展开全部”改变状态。
  const toggle = (key: Key) =>
    setExpanded((previous) =>
      previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key],
    );
  const groupedColumns: ColumnsType<GroupedRow<T>> = columns.map(
    (column, index) => ({
      // 分组表只复用展示属性；业务排序、过滤与单元格事件不能接收到目录包装对象。
      key: column.key ?? index,
      title:
        typeof column.title === "function" ? column.title({}) : column.title,
      width: column.width,
      minWidth: "minWidth" in column ? column.minWidth : undefined,
      fixed: column.fixed,
      align: column.align,
      ellipsis:
        column.ellipsis ?? ("dataIndex" in column && column.dataIndex != null),
      className: column.className,
      // 目录行横跨内容列，名称与数量不会因为某一业务列较窄而被截断。
      onCell: (node) =>
        node.record ? {} : { colSpan: index === 0 ? columns.length : 0 },
      render: (_, node, rowIndex) => {
        if (!node.record)
          return index === 0 ? (
            <strong>
              {node.label}{" "}
              <span className="muted">({node.children?.length})</span>
            </strong>
          ) : null;
        const record = node.record;
        const path = "dataIndex" in column ? column.dataIndex : undefined;
        const value = (
          Array.isArray(path) ? path : path == null ? [] : [path]
        ).reduce<unknown>(
          (current, key) =>
            current == null
              ? undefined
              : (current as Record<string, unknown>)[String(key)],
          record,
        );
        const rendered = column.render
          ? column.render(value, record, rowIndex)
          : value;
        // 兼容 Ant 旧式 render 的 {children, props} 返回值，只提取展示内容，不转交其业务行事件。
        if (
          rendered &&
          typeof rendered === "object" &&
          !isValidElement(rendered) &&
          ("children" in rendered || "props" in rendered)
        ) {
          return "children" in rendered
            ? (rendered.children as ReactNode)
            : null;
        }
        return rendered as ReactNode;
      },
    }),
  );
  return (
    <>
      <div className="tree-table-toolbar">
        <span className="muted">共 {rows.length} 个菜单</span>
        <Space>
          <Button
            size="small"
            onClick={() => setExpanded(tree.map((row) => row.key))}
          >
            展开全部
          </Button>
          <Button size="small" onClick={() => setExpanded([])}>
            折叠全部
          </Button>
        </Space>
      </div>
      <DataTable<GroupedRow<T>>
        aria-label="菜单层级"
        rowKey="key"
        columns={groupedColumns}
        dataSource={tree}
        sequence={(row) => row.sequence}
        pagination={false}
        loading={loading}
        size={size}
        rowClassName={(row) => (row.record ? "" : "table-group-row")}
        onRow={(row) =>
          row.record
            ? {}
            : {
                tabIndex: 0,
                "aria-label": `${row.label}目录`,
                "aria-expanded": expanded.includes(row.key),
                onKeyDown: (event) => {
                  // 行内展开按钮仍使用自身键盘行为，避免事件冒泡造成展开后立刻收起。
                  if (
                    event.target !== event.currentTarget ||
                    !["Enter", " "].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  toggle(row.key);
                },
              }
        }
        expandable={{
          expandRowByClick: true,
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => setExpanded([...keys]),
          expandIconColumnIndex: 1,
          indentSize: 22,
        }}
      />
    </>
  );
}
