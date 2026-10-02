import { Form, Input, Switch } from "antd";
import { ResourcePage } from "../../components/ResourcePage";
import { formatTime, StatusTag } from "../../components/shared";
import { contractClient, unwrapContract } from "../../lib/contract-client";
import type { components } from "../../types/generated/api";

/** DTO 类型来自服务端 OpenAPI；通用组件统一处理序号、分页、筛选、弹窗和操作权限。 */
type WorkOrderView = components["schemas"]["WorkOrderView"];
type WorkOrderRequest = components["schemas"]["WorkOrderRequest"];

/** 工单管理沿用通用列表与编辑弹窗，页面权限只控制交互，最终授权和版本校验仍由后端完成。 */
export function WorkOrderPage() {
  return (
    <ResourcePage<WorkOrderView>
      resource="workorders"
      endpoint="/business/workorders"
      title="工单管理"
      singular="工单"
      statusField="enabled"
      defaults={{ title: "", description: "", enabled: true }}
      transport={{
        // 从表单显式构造契约字段，编辑携带原版本，不接受额外身份或归属属性。
        save: async (values, editing) => {
          const body: WorkOrderRequest = {
            title: String(values.title ?? "").trim(),
            description: String(values.description ?? "").trim(),
            enabled: Boolean(values.enabled),
            version: editing?.version,
          };
          if (editing)
            unwrapContract(
              await contractClient.PUT("/api/business/workorders/{id}", {
                params: { path: { id: editing.id } },
                body,
              }),
            );
          else
            unwrapContract(
              await contractClient.POST("/api/business/workorders", { body }),
            );
        },
        // 删除同样提交页面读取到的版本，过期操作由服务端返回冲突后刷新列表。
        remove: async (record) => {
          unwrapContract(
            await contractClient.DELETE("/api/business/workorders/{id}", {
              params: {
                path: { id: record.id },
                query: { version: record.version },
              },
            }),
          );
        },
      }}
      columns={[
        { title: "标题", dataIndex: "title", ellipsis: true, width: 240 },
        { title: "说明", dataIndex: "description", ellipsis: true },
        {
          title: "状态",
          dataIndex: "enabled",
          width: 90,
          render: (value: boolean) => <StatusTag enabled={value} />,
        },
        {
          title: "更新时间",
          dataIndex: "updatedAt",
          width: 160,
          render: formatTime,
        },
      ]}
      fields={() => (
        <>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, whitespace: true, max: 160 }]}
          >
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item
            name="description"
            label="说明"
            rules={[{ required: false, whitespace: true, max: 1000 }]}
          >
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </>
      )}
    />
  );
}
