import { useEffect } from "react";
import { Button, Form, Input, Select, Space } from "antd";
import { useQuery } from "@tanstack/react-query";
import { FormModal } from "../FormModal";
import { UserSelect } from "../LookupSelect";
import { api } from "../../lib/api";
import {
  actionNames,
  type WorkflowNode,
  type WorkflowField,
} from "../../types/workflow";
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
  const [form] = Form.useForm();
  const type = Form.useWatch("type", form),
    source = Form.useWatch("source", form);
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
      onSubmit={async (values) => {
        onSave({
          ...values,
          conditions:
            values.type === "CONDITION" ? (values.conditions ?? []) : [],
          assigneeIds:
            values.source === "DEPARTMENT_LEADER"
              ? []
              : (values.assigneeIds ?? []),
          readable: values.readable ?? [],
          writable: values.writable ?? [],
          actions: values.type === "APPROVAL" ? (values.actions ?? []) : [],
        });
      }}
    >
      {node && (
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
          <Form.Item name="type" label="节点类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "APPROVAL", label: "审批" },
                { value: "CONDITION", label: "条件分支" },
                { value: "END", label: "结束" },
              ]}
            />
          </Form.Item>
          {type === "APPROVAL" && (
            <>
              <div className="form-two-columns">
                <Form.Item
                  name="source"
                  label="审批人来源"
                  rules={[{ required: true }]}
                >
                  <Select
                    onChange={() => form.setFieldValue("assigneeIds", [])}
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
                <Form.Item
                  name="mode"
                  label="多人审批方式"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={[
                      { value: "ALL", label: "会签 · 所有人同意" },
                      { value: "ANY", label: "或签 · 一人同意" },
                    ]}
                  />
                </Form.Item>
              </div>
              {source !== "DEPARTMENT_LEADER" && (
                <Form.Item
                  name="assigneeIds"
                  label={source === "ROLES" ? "角色" : "审批人员"}
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
              <Form.Item name="readable" label="可读字段">
                <Select
                  mode="multiple"
                  options={fields.map((f) => ({ value: f.id, label: f.label }))}
                />
              </Form.Item>
              <Form.Item
                name="writable"
                label="可写字段"
                extra="可写字段必须同时可读。"
              >
                <Select
                  mode="multiple"
                  options={fields.map((f) => ({ value: f.id, label: f.label }))}
                />
              </Form.Item>
              <Form.Item
                name="actions"
                label="允许操作"
                rules={[{ required: true, type: "array", min: 2 }]}
              >
                <Select
                  mode="multiple"
                  options={[
                    "APPROVE",
                    "REJECT",
                    "COMMENT",
                    "TRANSFER",
                    "ADD_SIGN",
                  ].map((value) => ({
                    value,
                    label: actionNames[value],
                    disabled: value === "APPROVE" || value === "REJECT",
                  }))}
                />
              </Form.Item>
            </>
          )}
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
                                ].includes(f.type),
                            )
                            .map((f) => ({ value: f.id, label: f.label }))}
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
                      <Button danger onClick={() => remove(row.name)}>
                        移除规则
                      </Button>
                    </div>
                  ))}
                  <Space>
                    <Button onClick={() => add({ operator: "EQ" })}>
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
      )}
    </FormModal>
  );
}
