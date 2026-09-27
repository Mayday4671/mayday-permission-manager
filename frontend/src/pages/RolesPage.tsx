import { useState } from "react";
import { Alert, Form, Input, Select, Switch, Tabs, Tag } from "antd";
import { PermissionPicker } from "../components/PermissionPicker";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ResourcePage } from "../components/ResourcePage";
import { StatusTag } from "../components/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { PermissionGroup, Role } from "../types";
import { scopeNames } from "./UsersPage";
import { DepartmentSelect } from "../components/DepartmentSelect";

/** 按服务端权限目录展示可配置范围的资源；切换范围时只在提交阶段去掉不再使用的部门。 */
function ScopeDepartments({
  value = [],
  onChange,
  groups,
}: {
  value?: Role["scopeDepartments"];
  onChange?: (value: Role["scopeDepartments"]) => void;
  groups: PermissionGroup[];
}) {
  const scopes = Form.useWatch("dataScopes") as Role["dataScopes"] | undefined;
  const { session } = useAuth();
  return (
    <div className="form-two-columns">
      {groups
        .filter((group) => scopes?.[group.key] === "CUSTOM")
        .map(({ key: resource, name }) => (
          <div key={resource}>
            <label>{name}数据部门</label>
            <DepartmentSelect
              disabled={!session?.admin}
              value={value
                .filter((item) => item.resource === resource)
                .map((item) => item.departmentId)}
              onChange={(ids) =>
                onChange?.([
                  ...value.filter((item) => item.resource !== resource),
                  ...ids.map((departmentId) => ({ resource, departmentId })),
                ])
              }
            />
          </div>
        ))}
    </div>
  );
}

export function RolesPage() {
  const { can, session } = useAuth();
  const [editorTab, setEditorTab] = useState("basic");
  const catalog = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api<PermissionGroup[]>("/system/roles/permissions"),
  });
  // 目录 scoped 标记同时决定表格摘要、范围表单与部门选择器，新模块无需复制角色页面。
  const scopedGroups = (catalog.data ?? []).filter((group) => group.scoped);
  return (
    <ResourcePage<Role>
      resource="roles"
      endpoint="/system/roles"
      title="角色与权限"
      singular="角色"
      width={900}
      onFormOpen={() => setEditorTab("basic")}
      onFormInvalid={(field) =>
        setEditorTab(
          field[0] === "dataScopes" || field[0] === "scopeDepartments"
            ? "scope"
            : field[0] === "permissions"
              ? "permissions"
              : "basic",
        )
      }
      defaults={{
        permissions: ["dashboard:view"],
        dataScopes: Object.fromEntries(
          scopedGroups.map((group) => [group.key, "SELF"]),
        ),
        scopeDepartments: [],
      }}
      beforeSave={(values) => ({
        ...values,
        scopeDepartments: (
          (values.scopeDepartments ?? []) as Role["scopeDepartments"]
        ).filter(
          (grant) =>
            (values.dataScopes as Role["dataScopes"])[grant.resource] ===
            "CUSTOM",
        ),
      })}
      createAllowed={can("roles:grant")}
      canEdit={(r) => r.code !== "admin" && can("roles:grant")}
      canDelete={(r) => r.code !== "admin"}
      columns={[
        {
          title: "角色",
          width: 210,
          render: (_, r) => (
            <div className="person-cell">
              <span
                className={`role-icon ${r.code === "admin" ? "admin" : ""}`}
              >
                <ShieldCheck size={19} />
              </span>
              <div>
                <strong>{r.name}</strong>
                <small>{r.code}</small>
              </div>
            </div>
          ),
        },
        { title: "角色描述", dataIndex: "description", width: 250 },
        {
          title: "授权操作",
          width: 115,
          render: (_, r) =>
            r.code === "admin" ? (
              <Tag color="purple">全部权限</Tag>
            ) : (
              <span className="permission-count">
                {r.permissions.length} 项权限
              </span>
            ),
        },
        {
          title: "数据范围",
          width: 180,
          render: (_, r) => (
            <div className="scope-cell">
              {scopedGroups.map((group) => (
                <span key={group.key}>
                  {group.name} ·{" "}
                  {r.code === "admin" ||
                  r.permissions.includes(`${group.key}:view`)
                    ? scopeNames[r.dataScopes[group.key] ?? "SELF"]
                    : "未授权"}
                </span>
              ))}
            </div>
          ),
        },
        {
          title: "状态",
          dataIndex: "enabled",
          width: 100,
          render: (v) => <StatusTag enabled={v} />,
        },
      ]}
      fields={(_record, form) => (
        <Tabs
          className="role-editor-tabs"
          activeKey={editorTab}
          onChange={setEditorTab}
          items={[
            {
              key: "basic",
              label: "基本信息",
              forceRender: true,
              children: (
                <>
                  <div className="form-two-columns">
                    <Form.Item
                      label="角色名称"
                      name="name"
                      rules={[{ required: true }]}
                    >
                      <Input placeholder="如 内容编辑" maxLength={64} />
                    </Form.Item>
                    <Form.Item
                      label="角色编码"
                      name="code"
                      rules={[
                        { required: true },
                        {
                          pattern: /^[A-Za-z0-9_]{2,64}$/,
                          message: "2–64 位字母、数字或下划线",
                        },
                      ]}
                    >
                      <Input placeholder="如 content_editor" maxLength={64} />
                    </Form.Item>
                  </div>
                  <Form.Item label="角色描述" name="description">
                    <Input.TextArea
                      rows={2}
                      maxLength={500}
                      placeholder="请输入角色描述"
                    />
                  </Form.Item>
                  <Form.Item
                    name="enabled"
                    label="启用角色"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </>
              ),
            },
            {
              key: "permissions",
              label: "操作权限",
              forceRender: true,
              children: (
                <>
                  <Form.Item name="permissions">
                    <PermissionPicker groups={catalog.data ?? []} />
                  </Form.Item>
                  {catalog.isError && (
                    <Alert
                      type="error"
                      title="权限目录加载失败，请关闭后重试"
                    />
                  )}
                </>
              ),
            },
            {
              key: "scope",
              label: "数据范围",
              forceRender: true,
              children: (
                <>
                  <p className="form-help">
                    多个有效角色按可访问记录取并集。指定部门不自动包含下级或本人。
                  </p>
                  <div className="form-two-columns">
                    {scopedGroups.map(({ key, name }) => (
                      <Form.Item
                        label={`${name}数据`}
                        name={["dataScopes", key]}
                        key={key}
                      >
                        <Select
                          options={Object.entries(scopeNames).map(
                            ([value, label]) => ({
                              value,
                              label,
                              disabled: !session?.admin && value !== "SELF",
                            }),
                          )}
                        />
                      </Form.Item>
                    ))}
                  </div>
                  <Form.Item
                    name="scopeDepartments"
                    rules={[
                      {
                        validator: (
                          _,
                          value: Role["scopeDepartments"] = [],
                        ) => {
                          const incomplete = scopedGroups.some(
                            ({ key: resource }) =>
                              form.getFieldValue(["dataScopes", resource]) ===
                                "CUSTOM" &&
                              !value.some(
                                (grant) => grant.resource === resource,
                              ),
                          );
                          return incomplete
                            ? Promise.reject(
                                new Error(
                                  "请为每个指定部门范围选择至少一个部门",
                                ),
                              )
                            : Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <ScopeDepartments groups={scopedGroups} />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      )}
    />
  );
}
