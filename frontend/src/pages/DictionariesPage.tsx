import { useState } from "react";
import { Button, Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import { List } from "lucide-react";
import { ResourcePage } from "../components/ResourcePage";
import { DetailsModal } from "../components/DetailsModal";
import { StatusTag, formatTime } from "../components/shared";
import type { BaseRecord, Entry } from "../types";

interface DictionaryItem extends BaseRecord {
  dictionaryId: number;
  label: string;
  value: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
}
const colors = [
  { value: "default", label: "默认" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "error", label: "错误" },
  { value: "processing", label: "处理中" },
  { value: "purple", label: "紫色" },
  { value: "blue", label: "蓝色" },
];

/** 类型和选项独立维护，选项列表仍复用通用分页/权限/编辑弹窗；类型弹窗不复制 CRUD 状态机。 */
export function DictionariesPage() {
  const [selected, setSelected] = useState<Entry | null>(null);
  return (
    <>
      <ResourcePage<Entry>
        resource="dictionaries"
        endpoint="/system/entries/dictionaries"
        title="数据字典"
        singular="字典类型"
        statusField="enabled"
        columns={[
          { title: "字典名称", dataIndex: "name", width: 200 },
          { title: "字典编码", dataIndex: "code", width: 200 },
          { title: "说明", dataIndex: "description", width: 260 },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 100,
            render: (value) => <StatusTag enabled={value} />,
          },
          {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 170,
            render: formatTime,
          },
        ]}
        extraActions={(record) => (
          <Button
            type="text"
            aria-label={`维护${record.name}字典项`}
            title="维护字典项"
            icon={<List size={16} />}
            onClick={() => setSelected(record)}
          />
        )}
        canDelete={(record) => record.code !== "user.status"}
        fields={(record) => (
          <>
            <Form.Item
              name="name"
              label="字典名称"
              rules={[{ required: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="code"
              label="字典编码"
              rules={[
                { required: true },
                {
                  pattern: /^[A-Za-z0-9_.:-]{1,100}$/,
                  message: "只允许字母、数字、点、冒号、下划线和短横线",
                },
              ]}
            >
              <Input
                disabled={record?.code === "user.status"}
                maxLength={100}
                placeholder="如 user.status"
              />
            </Form.Item>
            <Form.Item name="description" label="说明">
              <Input.TextArea maxLength={500} rows={2} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} max={9999} />
            </Form.Item>
            <Form.Item name="enabled" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </>
        )}
      />
      <DetailsModal
        title={`${selected?.name ?? ""} · 字典项`}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={1100}
      >
        {selected && (
          <ResourcePage<DictionaryItem>
            key={selected.id}
            resource="dictionaries"
            endpoint={`/system/dictionaries/${selected.id}/items`}
            title="字典项"
            singular="字典项"
            stateKey={`dictionaryItems.${selected.id}`}
            statusField="enabled"
            defaults={{ color: "default" }}
            canDelete={() => selected.code !== "user.status"}
            columns={[
              {
                title: "标签",
                dataIndex: "label",
                width: 180,
                render: (value, row) => <Tag color={row.color}>{value}</Tag>,
              },
              { title: "值", dataIndex: "value", width: 160 },
              { title: "排序", dataIndex: "sortOrder", width: 80 },
              {
                title: "状态",
                dataIndex: "enabled",
                width: 100,
                render: (value) => <StatusTag enabled={value} />,
              },
            ]}
            fields={(record) => (
              <>
                <Form.Item
                  name="label"
                  label="显示标签"
                  rules={[{ required: true }]}
                >
                  <Input maxLength={100} />
                </Form.Item>
                <Form.Item
                  name="value"
                  label="字典值"
                  rules={[{ required: true }]}
                >
                  {selected.code === "user.status" ? (
                    <Select
                      disabled={!!record}
                      options={[
                        { value: "true", label: "true（启用）" },
                        { value: "false", label: "false（停用）" },
                      ]}
                    />
                  ) : (
                    <Input maxLength={100} />
                  )}
                </Form.Item>
                <Form.Item name="color" label="标签样式">
                  <Select options={colors} />
                </Form.Item>
                <Form.Item name="sortOrder" label="排序">
                  <InputNumber min={0} max={9999} />
                </Form.Item>
                <Form.Item name="enabled" label="状态" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="停用" />
                </Form.Item>
              </>
            )}
          />
        )}
      </DetailsModal>
    </>
  );
}
