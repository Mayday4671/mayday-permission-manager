import { Button, Checkbox, Popover, Radio, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Columns3, Rows3 } from "lucide-react";
import { useBrowserPreference } from "../lib/useBrowserPreference";
import { readDensity, readHiddenColumns } from "../lib/list-preferences";

/**
 * 各列表复用的列显隐与密度设置。仅保存展示偏好，按账号、页面和嵌套资源在浏览器内隔离。
 * 只从当前已获授权的列生成选项；权限变化后不会因旧偏好恢复敏感列，操作列始终保留。
 */
export function useTablePreferences<T extends object>(
  columns: ColumnsType<T>,
  namespace = "",
  keepFirst = false,
) {
  const [hidden, setHidden] = useBrowserPreference(
    namespace + "table.hiddenColumns",
    readHiddenColumns,
  );
  const [density, setDensity] = useBrowserPreference(
    namespace + "table.density",
    readDensity,
  );
  const entries = columns.map((column, index) => ({
    column,
    key: String(
      column.key ??
        ("dataIndex" in column ? column.dataIndex : undefined) ??
        (typeof column.title === "string" ? column.title : index),
    ),
  }));
  const configurable = entries.filter(
    ({ column }) => typeof column.title === "string",
  );
  // 权限撤销可能移走最后一列。忽略首个仍有权限列的隐藏偏好，防止只剩空表和操作列。
  const requestedHidden = keepFirst
    ? hidden.filter((key) => key !== entries[0]?.key)
    : hidden;
  const allowedHidden =
    configurable.length &&
    configurable.every((entry) => requestedHidden.includes(entry.key))
      ? requestedHidden.filter((key) => key !== configurable[0].key)
      : requestedHidden;
  const visible = configurable.filter(
    (entry) => !allowedHidden.includes(entry.key),
  );
  const tools = (
    <Space size={4}>
      <Popover
        trigger="click"
        title="显示列"
        content={
          <div style={{ minWidth: 170, display: "grid", gap: 10 }}>
            {configurable.map(({ column, key }) => (
              <Checkbox
                key={key}
                checked={!allowedHidden.includes(key)}
                disabled={
                  (keepFirst && entries[0]?.key === key) ||
                  (visible.length === 1 && visible[0].key === key)
                }
                onChange={(event) =>
                  setHidden((previous) =>
                    event.target.checked
                      ? previous.filter((item) => item !== key)
                      : [...allowedHidden, key],
                  )
                }
              >
                {column.title as string}
              </Checkbox>
            ))}
            <Button size="small" onClick={() => setHidden([])}>
              恢复默认列
            </Button>
          </div>
        }
      >
        <Button
          aria-label="设置表格列"
          title="设置表格列"
          icon={<Columns3 size={16} />}
        />
      </Popover>
      <Popover
        trigger="click"
        title="表格密度"
        content={
          <Radio.Group
            value={density}
            onChange={(event) => setDensity(event.target.value)}
            options={[
              { value: "small", label: "紧凑" },
              { value: "middle", label: "标准" },
              { value: "large", label: "宽松" },
            ]}
          />
        }
      >
        <Button
          aria-label="设置表格密度"
          title="设置表格密度"
          icon={<Rows3 size={16} />}
        />
      </Popover>
    </Space>
  );
  return {
    columns: entries
      .filter((entry) => !allowedHidden.includes(entry.key))
      .map((entry) => entry.column),
    density,
    tools,
  };
}
