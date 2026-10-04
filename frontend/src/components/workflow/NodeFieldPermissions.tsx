import { Button, Radio, Space } from "antd";
import { DataTable } from "../DataTable";
import { useModalTablePagination } from "../useModalTablePagination";
import type { WorkflowField } from "../../types/workflow";

/** 节点字段权限用三态矩阵表达；可编辑必然可读，抄送仅允许隐藏或只读。 */
export function NodeFieldPermissions({
  fields,
  readable,
  writable,
  copy,
  onChange,
}: {
  fields: WorkflowField[];
  readable: string[];
  writable: string[];
  copy: boolean;
  onChange: (readable: string[], writable: string[]) => void;
}) {
  const { ref, page, pageSize, setPage } = useModalTablePagination(42, 6);
  const update = (id: string, state: string) =>
    onChange(
      [
        ...readable.filter((key) => key !== id),
        ...(state !== "hidden" ? [id] : []),
      ],
      [
        ...writable.filter((key) => key !== id),
        ...(state === "write" ? [id] : []),
      ],
    );
  return (
    <div className="node-field-permissions">
      <Space wrap>
        <Button
          size="small"
          onClick={() =>
            onChange(
              fields.map((field) => field.id),
              [],
            )
          }
        >
          全部只读
        </Button>
        <Button size="small" onClick={() => onChange([], [])}>
          全部隐藏
        </Button>
      </Space>
      <div ref={ref}>
        <DataTable
          rowKey="id"
          size="small"
          dataSource={fields}
          pagination={{
            current: page,
            pageSize,
            hideOnSinglePage: true,
            onChange: setPage,
          }}
          columns={[
            { title: "字段", dataIndex: "label" },
            {
              title: "节点权限",
              render: (_, field) => (
                <Radio.Group
                  aria-label={`${field.label}权限`}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  value={
                    writable.includes(field.id)
                      ? "write"
                      : readable.includes(field.id)
                        ? "read"
                        : "hidden"
                  }
                  onChange={(event) => update(field.id, event.target.value)}
                  options={[
                    { value: "hidden", label: "隐藏" },
                    { value: "read", label: "只读" },
                    ...(!copy && field.type !== "CALCULATED"
                      ? [{ value: "write", label: "可编辑" }]
                      : []),
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
