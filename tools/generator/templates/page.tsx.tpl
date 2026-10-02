import { Form, Input{{inputNumberImport}}, Switch } from "antd";
import { ResourcePage } from "../../components/ResourcePage";
import { formatTime, StatusTag } from "../../components/shared";
import { contractClient, unwrapContract } from "../../lib/contract-client";
import type { components } from "../../types/generated/api";

/** DTO 类型来自服务端 OpenAPI；通用组件统一处理序号、分页、筛选、弹窗和操作权限。 */
type {{entity}}View = components["schemas"]["{{entity}}View"];
type {{entity}}Request = components["schemas"]["{{entity}}Request"];

/** {{label}}沿用通用列表与编辑弹窗，页面权限只控制交互，最终授权和版本校验仍由后端完成。 */
export function {{entity}}Page() {
  return (
    <ResourcePage<{{entity}}View>
      resource="{{resource}}"
      endpoint="/business/{{resource}}"
      title="{{label}}"
      singular="{{singular}}"
      statusField="enabled"
      defaults={{ {{frontendDefaults}} }}
      transport={{
        // 从表单显式构造契约字段，编辑携带原版本，不接受额外身份或归属属性。
        save: async (values, editing) => {
          const body: {{entity}}Request = {
{{frontendPayload}},
            version: editing?.version,
          };
          if (editing) unwrapContract(await contractClient.PUT("/api/business/{{resource}}/{id}", {
            params: { path: { id: editing.id } }, body,
          }));
          else unwrapContract(await contractClient.POST("/api/business/{{resource}}", { body }));
        },
        // 删除同样提交页面读取到的版本，过期操作由服务端返回冲突后刷新列表。
        remove: async (record) => {
          unwrapContract(await contractClient.DELETE("/api/business/{{resource}}/{id}", {
            params: { path: { id: record.id }, query: { version: record.version } },
          }));
        },
      }}
      columns={[
{{frontendColumns}},
        { title: "状态", dataIndex: "enabled", width: 90, render: (value: boolean) => <StatusTag enabled={value} /> },
        { title: "更新时间", dataIndex: "updatedAt", width: 160, render: formatTime },
      ]}
      fields={() => <>
{{frontendFields}}
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
      </>}
    />
  );
}
