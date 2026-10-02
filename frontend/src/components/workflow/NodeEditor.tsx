import { useEffect } from "react";
import { Button, Form, Input, InputNumber, Select, Space, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { FormModal } from "../FormModal";
import { UserSelect } from "../LookupSelect";
import { api } from "../../lib/api";
import { NodeFieldPermissions } from "./NodeFieldPermissions";
import {
  actionNames,
  type WorkflowNode,
  type WorkflowField,
} from "../../types/workflow";
/** 角色选择目录仍由后端限定；选择来源不会替当前账号扩大审批或通讯录查看权限。 */
export function WorkflowRoleSelect(props: {
  value?: number[];
  onChange?: (value: number[]) => void;
  id?: string;
}) {
  const query = useQuery({
    queryKey: ["workflows", "role-options"],
    queryFn: () =>
      api<{ value: number; label: string }[]>("/operations/workflows/roles"),
  });
  return (
    <Select
      {...props}
      mode="multiple"
      showSearch={{ optionFilterProp: "label" }}
      options={query.data}
      loading={query.isLoading}
      status={query.isError ? "error" : undefined}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
    />
  );
}
/** 节点只开放运行引擎已经实现的动作、人员来源和条件操作。所有属性仍会在服务端发布前重新验证。 */
export function NodeEditor({
  node,
  existing,
  nodes,
  fields,
  personOptions,
  onClose,
  onSave,
}: {
  node: WorkflowNode | null;
  existing: boolean;
  nodes: WorkflowNode[];
  fields: WorkflowField[];
  personOptions?: { value: number; label: string }[];
  onClose: () => void;
  onSave: (node: WorkflowNode) => void;
}) {
  const [form] = Form.useForm<WorkflowNode>();
  const type = Form.useWatch("type", form),
    source = Form.useWatch("source", form);
  const readable = Form.useWatch("readable", { form, preserve: true }) ?? [],
    writable = Form.useWatch("writable", { form, preserve: true }) ?? [];
  useEffect(() => {
    if (node) {
      form.resetFields();
      form.setFieldsValue({
        ...node,
        readable: node.readable ?? [],
        writable: node.writable ?? [],
        actions: node.actions ?? ["APPROVE", "REJECT"],
        conditions: node.conditions ?? [],
        assigneeIds: node.assigneeIds ?? [],
      });
    }
  }, [node]);
  const exits = nodes
    .filter((n) => n.id !== node?.id)
    .map((n) => ({ value: n.id, label: n.name + " (" + n.id + ")" }));
  return (
    <FormModal
      title={existing ? "编辑流程节点" : "添加流程节点"}
      open={node !== null}
      form={form}
      width={850}
      onCancel={onClose}
      onSubmit={async () => {
        const values = form.getFieldsValue(true);
        onSave({
          ...values,
          conditions:
            values.type === "CONDITION" ? (values.conditions ?? []) : [],
          assigneeIds:
            values.source === "DEPARTMENT_LEADER"
              ? []
              : (values.assigneeIds ?? []),
          readable: values.readable ?? [],
          writable: values.type === "APPROVAL" ? (values.writable ?? []) : [],
          actions: values.type === "APPROVAL" ? (values.actions ?? []) : [],
          timeoutMinutes:
            values.type === "APPROVAL" ? (values.timeoutMinutes ?? null) : null,
        });
      }}
    >
      {node && (
        <Tabs
          key={node.id}
          defaultActiveKey="basic"
          items={[
            {
              key: "basic",
              label: "节点设置",
              forceRender: true,
              children: (
                <>
                  <div className="form-two-columns">
                    <Form.Item
                      name="name"
                      label="节点名称"
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item
                      name="id"
                      label="节点 ID"
                      rules={[
                        { required: true },
                        { pattern: /^[A-Za-z][A-Za-z0-9_]{0,39}$/ },
                      ]}
                    >
                      <Input disabled={existing} maxLength={40} />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="type"
                    label="节点类型"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: "APPROVAL", label: "审批" },
                        { value: "COPY", label: "抄送" },
                        { value: "CONDITION", label: "条件分支" },
                        { value: "END", label: "结束" },
                      ]}
                    />
                  </Form.Item>
                  {(type === "APPROVAL" || type === "COPY") && (
                    <>
                      <div className="form-two-columns">
                        <Form.Item
                          name="source"
                          label={type === "COPY" ? "抄送人来源" : "审批人来源"}
                          rules={[{ required: true }]}
                        >
                          <Select
                            onChange={() =>
                              form.setFieldValue("assigneeIds", [])
                            }
                            options={[
                              { value: "USERS", label: "指定人员" },
                              { value: "ROLES", label: "指定角色成员" },
                              {
                                value: "DEPARTMENT_LEADER",
                                label: "发起人所在部门负责人",
                              },
                            ]}
                          />
                        </Form.Item>
                        {type === "APPROVAL" && (
                          <Form.Item
                            name="mode"
                            label="多人审批方式"
                            rules={[{ required: true }]}
                          >
                            <Select
                              options={[
                                { value: "ALL", label: "会签 · 所有人同意" },
                                { value: "ANY", label: "或签 · 一人同意" },
                                {
                                  value: "SERIAL",
                                  label: "顺签 · 按所选顺序依次办理",
                                },
                              ]}
                            />
                          </Form.Item>
                        )}
                      </div>
                      {source !== "DEPARTMENT_LEADER" && (
                        <Form.Item
                          name="assigneeIds"
                          label={
                            source === "ROLES"
                              ? "角色"
                              : type === "COPY"
                                ? "抄送人员"
                                : "审批人员（选择顺序即顺签顺序）"
                          }
                          rules={[{ required: true, type: "array", min: 1 }]}
                        >
                          {source === "ROLES" ? (
                            <WorkflowRoleSelect />
                          ) : (
                            <UserSelect
                              initialOptions={personOptions}
                              mode="multiple"
                            />
                          )}
                        </Form.Item>
                      )}
                    </>
                  )}
                  {type !== "END" && (
                    <Form.Item
                      name="next"
                      label={type === "CONDITION" ? "默认出口" : "下一节点"}
                      rules={[{ required: true }]}
                    >
                      <Select options={exits} />
                    </Form.Item>
                  )}
                </>
              ),
            },
            ...(type === "APPROVAL" || type === "COPY"
              ? [
                  {
                    key: "fields",
                    label: "字段权限",
                    forceRender: true,
                    children: (
                      <>
                        {" "}
                        <Form.Item>
                          <NodeFieldPermissions
                            fields={fields}
                            readable={readable}
                            writable={writable}
                            copy={type === "COPY"}
                            onChange={(nextRead, nextWrite) =>
                              form.setFieldsValue({
                                readable: nextRead,
                                writable: nextWrite,
                              })
                            }
                          />
                        </Form.Item>
                      </>
                    ),
                  },
                ]
              : []),
            ...(type === "APPROVAL"
              ? [
                  {
                    key: "handling",
                    label: "办理设置",
                    forceRender: true,
                    children: (
                      <>
                        {" "}
                        {type === "APPROVAL" && (
                          <>
                            <Form.Item
                              name="actions"
                              label="允许操作"
                              rules={[
                                { required: true, type: "array", min: 2 },
                              ]}
                            >
                              <Select
                                mode="multiple"
                                options={[
                                  "APPROVE",
                                  "REJECT",
                                  "RETURN",
                                  "COMMENT",
                                  "TRANSFER",
                                  "ADD_SIGN",
                                ].map((value) => ({
                                  value,
                                  label: actionNames[value],
                                  disabled:
                                    value === "APPROVE" || value === "REJECT",
                                }))}
                              />
                            </Form.Item>
                            <Form.Item
                              name="timeoutMinutes"
                              label="超时提醒（分钟）"
                              extra="留空不提醒。超时后仅发送一次站内提醒，不自动同意或驳回。"
                            >
                              <InputNumber
                                min={1}
                                max={43200}
                                precision={0}
                                style={{ width: "100%" }}
                                placeholder="例如 1440（24 小时）"
                              />
                            </Form.Item>
                          </>
                        )}
                      </>
                    ),
                  },
                ]
              : []),
            ...(type === "CONDITION"
              ? [
                  {
                    key: "conditions",
                    label: "分支规则",
                    forceRender: true,
                    children: (
                      <>
                        {" "}
                        {type === "CONDITION" && (
                          <Form.List name="conditions">
                            {(rows, { add, remove }) => (
                              <div className="condition-rules">
                                {rows.map((row) => (
                                  <div key={row.key} className="condition-rule">
                                    <Form.Item
                                      name={[row.name, "field"]}
                                      label="字段"
                                      rules={[{ required: true }]}
                                    >
                                      <Select
                                        options={fields
                                          .filter(
                                            (f) =>
                                              ![
                                                "FILES",
                                                "MULTI",
                                                "USER",
                                                "DEPARTMENT",
                                                "DATE_RANGE",
                                                "DETAILS",
                                              ].includes(f.type),
                                          )
                                          .map((f) => ({
                                            value: f.id,
                                            label: f.label,
                                          }))}
                                      />
                                    </Form.Item>
                                    <Form.Item
                                      name={[row.name, "operator"]}
                                      label="比较"
                                      rules={[{ required: true }]}
                                    >
                                      <Select
                                        options={[
                                          { value: "EQ", label: "等于" },
                                          { value: "NE", label: "不等于" },
                                          { value: "GT", label: "大于" },
                                          { value: "GE", label: "大于等于" },
                                          { value: "LT", label: "小于" },
                                          { value: "LE", label: "小于等于" },
                                          { value: "CONTAINS", label: "包含" },
                                        ]}
                                      />
                                    </Form.Item>
                                    <Form.Item
                                      name={[row.name, "value"]}
                                      label="比较值"
                                      rules={[{ required: true }]}
                                    >
                                      <Input maxLength={1000} />
                                    </Form.Item>
                                    <Form.Item
                                      name={[row.name, "next"]}
                                      label="满足时前往"
                                      rules={[{ required: true }]}
                                    >
                                      <Select options={exits} />
                                    </Form.Item>
                                    <Button
                                      danger
                                      onClick={() => remove(row.name)}
                                    >
                                      移除规则
                                    </Button>
                                  </div>
                                ))}
                                <Space>
                                  <Button
                                    onClick={() => add({ operator: "EQ" })}
                                  >
                                    添加规则
                                  </Button>
                                  <span className="muted">
                                    从上到下匹配第一条满足的规则。
                                  </span>
                                </Space>
                              </div>
                            )}
                          </Form.List>
                        )}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </FormModal>
  );
}
