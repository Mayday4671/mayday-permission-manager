import { Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Folder, Settings2 } from "lucide-react";
import { ResourcePage } from "../components/ResourcePage";
import { DepartmentField } from "../components/DepartmentSelect";
import { UserSelect } from "../components/LookupSelect";
import { adminPages } from "../lib/workspace-model";
import { formatTime, StatusTag } from "../components/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Entry, Lookups } from "../types";

const definitions: Record<string, { title: string; singular: string }> = {
  approvalcategories: { title: "审批分类", singular: "分类" },
  posts: { title: "岗位管理", singular: "岗位" },
  categories: { title: "内容分类", singular: "分类" },
  tags: { title: "内容标签", singular: "标签" },
  departments: {
    title: "组织部门",
    singular: "部门",
  },
  menus: {
    title: "菜单管理",
    singular: "菜单",
  },
  dictionaries: {
    title: "数据字典",
    singular: "字典",
  },
  settings: {
    title: "系统参数",
    singular: "参数",
  },
};
/** 基础资料模块共用列表、表单和权限行为，仅声明各自字段。 */
export function EntriesPage({ kind }: { kind: string }) {
  const { session } = useAuth();
  const def = definitions[kind];
  const lookups = useQuery({
    queryKey: ["lookups"],
    queryFn: () => api<Lookups>("/system/lookups"),
  });
  const readOnly = kind === "departments" && !session?.admin;
  return (
    <ResourcePage<Entry>
      key={kind}
      resource={kind}
      endpoint={`/system/entries/${kind}`}
      {...def}
      statusField="enabled"
      readOnly={readOnly}
      groupBy={
        kind === "menus"
          ? (entry) =>
              adminPages.find((page) => page.path === entry.path)?.group ??
              "其他菜单"
          : undefined
      }
      beforeSave={(values) =>
        kind === "menus"
          ? {
              ...values,
              permission: adminPages.find((page) => page.path === values.path)
                ?.permission,
            }
          : values
      }
      columns={[
        {
          title: `${def.singular}名称`,
          width: 230,
          minWidth: kind === "menus" ? 170 : undefined,
          ellipsis: true,
          render: (_, e) => (
            <div className="person-cell">
              {kind !== "menus" && (
                <span className="entry-icon">
                  {kind === "departments" ? (
                    <Folder size={18} />
                  ) : kind === "dictionaries" ? (
                    <BookOpen size={18} />
                  ) : (
                    <Settings2 size={18} />
                  )}
                </span>
              )}
              <div>
                <strong>{e.name}</strong>
                <small>{e.code}</small>
              </div>
            </div>
          ),
        },
        ...(kind === "departments"
          ? [
              {
                title: "上级部门",
                width: 170,
                render: (_: unknown, e: Entry) =>
                  lookups.data?.departments.find((d) => d.id === e.parentId)
                    ?.name ?? "顶级部门",
              },
            ]
          : []),
        ...(kind === "menus"
          ? [
              {
                title: "路由地址",
                dataIndex: "path",
                width: 170,
                render: (p: string) => <code className="inline-code">{p}</code>,
              },
              {
                title: "访问权限",
                dataIndex: "permission",
                width: 170,
                render: (p: string) => <Tag color="purple">{p}</Tag>,
              },
            ]
          : []),
        ...(["settings", "dictionaries"].includes(kind)
          ? [
              {
                title: "配置值",
                dataIndex: "value",
                width: 240,
                ellipsis: true,
                render: (v: string) => (
                  <code className="inline-code">{v || "—"}</code>
                ),
              },
            ]
          : []),
        ...(kind === "menus"
          ? [{ title: "排序", dataIndex: "sortOrder", width: 80 }]
          : [
              {
                title: "说明",
                dataIndex: "description",
                width: 260,
                ellipsis: true,
              },
            ]),
        {
          title: "状态",
          dataIndex: "enabled",
          width: 100,
          render: (v) => <StatusTag enabled={v} />,
        },
        ...(kind === "menus"
          ? []
          : [
              {
                title: "更新时间",
                dataIndex: "updatedAt",
                width: 170,
                render: formatTime,
              },
            ]),
      ]}
      fields={(record, form) => (
        <>
          <div className="form-two-columns">
            <Form.Item
              label={`${def.singular}名称`}
              name="name"
              rules={[{ required: true }]}
            >
              <Input
                maxLength={["categories", "tags"].includes(kind) ? 32 : 100}
                placeholder={`输入${def.singular}名称`}
              />
            </Form.Item>
            <Form.Item
              label="唯一编码"
              name="code"
              rules={[
                { required: true },
                {
                  pattern: /^[A-Za-z0-9_.:-]{1,100}$/,
                  message: "仅支持字母、数字、下划线、点、冒号和短横线",
                },
              ]}
            >
              <Input maxLength={100} placeholder="如 team.product" />
            </Form.Item>
          </div>
          {kind === "departments" && (
            <>
              <Form.Item label="上级部门" name="parentId">
                <DepartmentField excludeId={record?.id} />
              </Form.Item>
              <Form.Item label="部门负责人" name="leaderId">
                <UserSelect />
              </Form.Item>
            </>
          )}
          {kind === "menus" && (
            <>
              <Form.Item
                label="所属目录"
                shouldUpdate={(before, after) => before.path !== after.path}
              >
                {() => (
                  <Input
                    disabled
                    value={
                      adminPages.find(
                        (page) => page.path === form.getFieldValue("path"),
                      )?.group ?? "选择路由后自动匹配"
                    }
                  />
                )}
              </Form.Item>
              <Form.Item
                label="路由地址"
                name="path"
                rules={[
                  { required: true },
                  {
                    pattern: /^\/admin(?:\/[a-z-]+)?$/,
                    message: "请输入 /admin 下的站内路径",
                  },
                ]}
                extra="路由对应的页面需已在前端注册"
              >
                <Select
                  showSearch={{ optionFilterProp: "label" }}
                  placeholder="选择已实现的页面"
                  options={adminPages
                    .filter(
                      (page) =>
                        page.permission !== null &&
                        page.screen !== "workflowDesigner",
                    )
                    .map((page) => ({
                      value: page.path,
                      label: `${page.title} · ${page.path}`,
                    }))}
                  onChange={(path) =>
                    form.setFieldsValue({
                      permission: adminPages.find((page) => page.path === path)
                        ?.permission,
                    })
                  }
                />
              </Form.Item>
              <Form.Item
                label="菜单权限"
                name="permission"
                rules={[{ required: true }]}
              >
                <Input disabled />
              </Form.Item>
              <Form.Item label="菜单图标" name="icon">
                <Select
                  allowClear
                  placeholder="使用页面默认图标"
                  options={[
                    ["dashboard", "仪表盘"],
                    ["users", "人员"],
                    ["roles", "权限"],
                    ["departments", "组织"],
                    ["menus", "菜单"],
                    ["notices", "文档"],
                    ["dictionaries", "字典"],
                    ["settings", "设置"],
                    ["logs", "日志"],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </Form.Item>
            </>
          )}
          {["dictionaries", "settings"].includes(kind) && (
            <Form.Item
              label={kind === "dictionaries" ? "选项值" : "参数值"}
              name="value"
              extra={
                kind === "dictionaries"
                  ? "多个选项使用英文逗号分隔；content.category 控制内容分类"
                  : "site.name、site.contact 用于前台门户。请勿存放密码或密钥。"
              }
            >
              <Input.TextArea
                rows={3}
                maxLength={2000}
                placeholder="输入配置内容"
              />
            </Form.Item>
          )}
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} maxLength={500} placeholder="请输入说明" />
          </Form.Item>
          <div className="form-two-columns">
            <Form.Item label="排序" name="sortOrder">
              <InputNumber min={0} max={9999} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="状态" name="enabled" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </div>
        </>
      )}
    />
  );
}
