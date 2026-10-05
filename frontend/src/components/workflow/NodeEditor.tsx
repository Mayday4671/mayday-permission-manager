import { useEffect, useState } from "react";
import { Button, Form, Input, InputNumber, Select, Space, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { FormModal } from "../FormModal";
import { UserSelect } from "../LookupSelect";
import { api } from "../../lib/api";
import { NodeFieldPermissions } from "./NodeFieldPermissions";
import { ConditionGroupEditor } from "./ConditionGroupEditor";
import { WorkflowSubprocessEditor } from "./WorkflowSubprocessEditor";
import { conditionIssues, conditionLeaves } from "../../lib/workflowConditions";
import { subprocessMappingIssues } from "../../lib/workflowSubprocess";
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

interface NodeEditorProps {
  node: WorkflowNode | null;
  existing: boolean;
  nodes: WorkflowNode[];
  fields: WorkflowField[];
  personOptions?: { value: number; label: string }[];
  /** 连线由 OA 画布自动维护时，隐藏标识、类型和手工出口选择。 */
  structured?: boolean;
  /** 从零开始的条件序号；null 表示编辑整个条件节点。 */
  branchIndex?: number | null;
  onClose: () => void;
  onSave: (node: WorkflowNode) => void;
}

/**
 * 节点弹窗只编辑业务属性；结构化设计器负责维护节点类型、稳定标识和分支连线。
 * structured 默认为 false，兼容旧图编辑入口；开启后不再要求用户手动选择技术节点 ID。
 * branchIndex 指定单个条件分支，其他分支留在表单存储中，保存时原样保留。
 * 运行引擎未实现的人员来源、动作和规则不会在此开放，发布仍由服务端完整校验。
 */
export function NodeEditor({
  node,
  existing,
  nodes,
  fields,
  personOptions,
  structured = false,
  branchIndex = null,
  onClose,
  onSave,
}: NodeEditorProps) {
  const [form] = Form.useForm<WorkflowNode>();
  const [activeTab, setActiveTab] = useState("basic");
  const [activeRule, setActiveRule] = useState("0");
  const type = Form.useWatch("type", { form, preserve: true }) ?? node?.type;
  const source = Form.useWatch("source", { form, preserve: true });
  const readable = Form.useWatch("readable", { form, preserve: true }) ?? [];
  const writable = Form.useWatch("writable", { form, preserve: true }) ?? [];
  const conditions =
    Form.useWatch("conditions", { form, preserve: true }) ?? [];
  const focusedBranch = structured && branchIndex !== null && branchIndex >= 0;

  useEffect(() => {
    if (!node) return;
    form.resetFields();
    form.setFieldsValue({
      ...node,
      readable: node.readable ?? [],
      writable: node.writable ?? [],
      actions: node.actions ?? ["APPROVE", "REJECT"],
      conditions: node.conditions ?? [],
      assigneeIds: node.assigneeIds ?? [],
    });
    setActiveTab(focusedBranch ? "conditions" : "basic");
    setActiveRule(String(branchIndex ?? 0));
  }, [node, form, branchIndex, focusedBranch]);

  const exits = nodes
    .filter((candidate) => candidate.id !== node?.id)
    .map((candidate) => ({
      value: candidate.id,
      label: `${candidate.name} (${candidate.id})`,
    }));
  const conditionFields = fields
    .filter((field) =>
      [
        "TEXT",
        "TEXTAREA",
        "NUMBER",
        "MONEY",
        "CALCULATED",
        "DATE",
        "DATETIME",
        "SINGLE",
      ].includes(field.type),
    )
    .map((field) => ({ value: field.id, label: field.label }));
  const title = structured
    ? focusedBranch
      ? `条件${(branchIndex ?? 0) + 1}设置`
      : node?.type === "APPROVAL"
        ? "审批人设置"
        : node?.type === "COPY"
          ? "抄送设置"
          : node?.type === "SUBPROCESS"
            ? "子流程设置"
            : node?.type === "PARALLEL"
              ? "并行分支设置"
              : node?.type === "CONDITION"
                ? "条件分支设置"
                : "节点设置"
    : existing
      ? "编辑流程节点"
      : "添加流程节点";

  /** 每条条件只编辑比较规则；分支出口由画布连接关系决定，隐藏注册可避免保存丢失。 */
  const renderCondition = (row: { name: number; key: number }) => {
    const rule = conditions[row.name];
    if (rule?.predicate)
      return (
        <div key={row.key}>
          <Form.Item
            name={[row.name, "predicate"]}
            label="组合条件"
            rules={[
              {
                validator: async (_, predicate) => {
                  const issues = conditionIssues(
                    { next: rule.next, predicate },
                    fields,
                  );
                  if (issues.length) throw new Error(issues[0]);
                },
              },
            ]}
          >
            <ConditionGroupEditor fields={fields} />
          </Form.Item>
          <Form.Item
            name={[row.name, "next"]}
            hidden={structured}
            label="满足时前往"
            rules={[{ required: true }]}
          >
            {structured ? <Input /> : <Select options={exits} />}
          </Form.Item>
          <Button
            disabled={conditionLeaves(rule).length !== 1}
            onClick={() => {
              const first = conditionLeaves(rule)[0];
              form.setFieldValue(["conditions", row.name], {
                field: first.field ?? "",
                operator: first.operator ?? "EQ",
                value: first.value ?? "",
                next: rule.next,
              });
            }}
          >
            改为单条件
          </Button>
        </div>
      );
    const field = fields.find((candidate) => candidate.id === rule?.field);
    const numeric =
      field?.type === "NUMBER" ||
      field?.type === "MONEY" ||
      field?.type === "CALCULATED";
    const operators = [
      { value: "EQ", label: "等于" },
      { value: "NE", label: "不等于" },
      ...(numeric
        ? [
            { value: "GT", label: "大于" },
            { value: "GE", label: "大于等于" },
            { value: "LT", label: "小于" },
            { value: "LE", label: "小于等于" },
          ]
        : []),
      { value: "CONTAINS", label: "包含" },
    ];
    return (
      <div key={row.key} className="condition-rule">
        <Button
          onClick={() =>
            form.setFieldValue(["conditions", row.name], {
              next: rule?.next,
              predicate: {
                logic: "AND",
                children: [
                  {
                    field: rule?.field ?? "",
                    operator: rule?.operator ?? "EQ",
                    value: rule?.value ?? "",
                  },
                ],
              },
            })
          }
        >
          增加组合判断
        </Button>
        <Form.Item
          name={[row.name, "field"]}
          label="表单字段"
          rules={[
            { required: true, message: "请选择用于判断的表单字段。" },
            {
              validator: async (_, value) => {
                if (
                  value &&
                  !conditionFields.some(
                    (candidate) => candidate.value === value,
                  )
                )
                  throw new Error("该字段已移除或不支持条件判断，请重新选择。");
              },
            },
          ]}
        >
          <Select
            options={conditionFields}
            placeholder="选择表单字段"
            onChange={(fieldId: string) => {
              const selected = fields.find(
                (candidate) => candidate.id === fieldId,
              );
              const supportsNumeric =
                selected?.type === "NUMBER" ||
                selected?.type === "MONEY" ||
                selected?.type === "CALCULATED";
              if (
                !supportsNumeric &&
                ["GT", "GE", "LT", "LE"].includes(rule?.operator ?? "")
              )
                form.setFieldValue(["conditions", row.name, "operator"], "EQ");
              // 主动更换比较字段后重填比较值；打开旧配置不会触发此路径或悄悄修改条件。
              form.setFieldValue(["conditions", row.name, "value"], "");
            }}
          />
        </Form.Item>
        <Form.Item
          name={[row.name, "operator"]}
          label="比较方式"
          rules={[
            { required: true, message: "请选择比较方式。" },
            {
              validator: async (_, value) => {
                if (
                  value &&
                  !operators.some((operator) => operator.value === value)
                )
                  throw new Error("大小比较只适用于数字或金额字段。");
              },
            },
          ]}
        >
          <Select options={operators} />
        </Form.Item>
        <Form.Item
          name={[row.name, "value"]}
          label="比较值"
          getValueFromEvent={
            numeric && rule?.operator !== "CONTAINS"
              ? (value) => (value === null ? "" : String(value))
              : undefined
          }
          rules={[
            { required: true, message: "请输入比较值。" },
            {
              validator: async (_, value) => {
                if (value === undefined || value === null || value === "")
                  return;
                if (
                  numeric &&
                  rule?.operator !== "CONTAINS" &&
                  !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
                    String(value),
                  )
                )
                  throw new Error("请输入有效数字。");
                if (
                  field?.type === "SINGLE" &&
                  ["EQ", "NE"].includes(rule?.operator ?? "") &&
                  !field.options?.includes(String(value))
                )
                  throw new Error("请选择此字段的已有选项。");
              },
            },
          ]}
        >
          {/* 单选包含允许输入选项的任意子串；只有等于/不等于需要保持原选项成员。 */}
          {field?.type === "SINGLE" &&
          ["EQ", "NE"].includes(rule?.operator ?? "") ? (
            <Select
              options={field.options?.map((option) => ({
                value: option,
                label: option,
              }))}
            />
          ) : numeric && rule?.operator !== "CONTAINS" ? (
            <InputNumber<string> stringMode style={{ width: "100%" }} />
          ) : (
            <Input
              maxLength={1000}
              type={
                field?.type === "DATE"
                  ? "date"
                  : field?.type === "DATETIME"
                    ? "datetime-local"
                    : "text"
              }
            />
          )}
        </Form.Item>
        {structured ? (
          <Form.Item name={[row.name, "next"]} hidden>
            <Input />
          </Form.Item>
        ) : (
          <Form.Item
            name={[row.name, "next"]}
            label="满足时前往"
            rules={[{ required: true }]}
          >
            <Select options={exits} />
          </Form.Item>
        )}
      </div>
    );
  };

  return (
    <FormModal
      title={title}
      open={node !== null}
      form={form}
      width={focusedBranch ? 560 : 850}
      onCancel={onClose}
      onInvalid={(field) => {
        if (field[0] === "conditions") {
          setActiveTab("conditions");
          if (typeof field[1] === "number") setActiveRule(String(field[1]));
        } else if (field[0] === "actions" || field[0] === "timeoutMinutes") {
          setActiveTab("handling");
        } else {
          setActiveTab("basic");
        }
      }}
      onSubmit={async () => {
        const values = form.getFieldsValue(true);
        if (
          focusedBranch &&
          (branchIndex === null || !values.conditions?.[branchIndex])
        )
          throw new Error("所选条件已移除，请关闭后重新选择分支。");
        onSave({
          ...values,
          conditions:
            values.type === "CONDITION" ? (values.conditions ?? []) : [],
          assigneeIds:
            values.source === "DEPARTMENT_LEADER"
              ? []
              : (values.assigneeIds ?? []),
          readable: values.readable ?? [],
          writable:
            values.type === "APPROVAL" || values.type === "SUBPROCESS"
              ? (values.writable ?? [])
              : [],
          actions: values.type === "APPROVAL" ? (values.actions ?? []) : [],
          timeoutMinutes:
            values.type === "APPROVAL" ? (values.timeoutMinutes ?? null) : null,
        });
      }}
    >
      {node && (
        <>
          {structured && (
            <>
              {/* 稳定标识和连线仍注册到表单，用户只需要配置实际业务属性。 */}
              <Form.Item name="id" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="type" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="next" hidden>
                <Input />
              </Form.Item>
              {focusedBranch && (
                <Form.Item name="name" hidden>
                  <Input />
                </Form.Item>
              )}
            </>
          )}
          <Tabs
            key={node.id}
            activeKey={activeTab}
            onChange={setActiveTab}
            renderTabBar={focusedBranch ? () => <></> : undefined}
            items={[
              ...(!focusedBranch
                ? [
                    {
                      key: "basic",
                      label: "节点设置",
                      forceRender: true,
                      children: (
                        <>
                          <div
                            className={
                              structured ? undefined : "form-two-columns"
                            }
                          >
                            <Form.Item
                              name="name"
                              label="节点名称"
                              rules={[{ required: true, whitespace: true }]}
                            >
                              <Input maxLength={80} />
                            </Form.Item>
                            {!structured && (
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
                            )}
                          </div>
                          {!structured && (
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
                                  { value: "PARALLEL", label: "并行分支" },
                                  { value: "SUBPROCESS", label: "子流程" },
                                  { value: "END", label: "结束" },
                                ]}
                              />
                            </Form.Item>
                          )}
                          {(type === "APPROVAL" || type === "COPY") && (
                            <>
                              <div className="form-two-columns">
                                <Form.Item
                                  name="source"
                                  label={
                                    type === "COPY"
                                      ? "抄送人来源"
                                      : "审批人来源"
                                  }
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
                                        {
                                          value: "ALL",
                                          label: "会签 · 所有人同意",
                                        },
                                        {
                                          value: "ANY",
                                          label: "或签 · 一人同意",
                                        },
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
                                  rules={[
                                    { required: true, type: "array", min: 1 },
                                  ]}
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
                          {!structured && type !== "END" && (
                            <Form.Item
                              name="next"
                              label={
                                type === "CONDITION" ? "默认出口" : "下一节点"
                              }
                              rules={[{ required: true }]}
                            >
                              <Select options={exits} />
                            </Form.Item>
                          )}
                        </>
                      ),
                    },
                  ]
                : []),
              ...(type === "SUBPROCESS"
                ? [
                    {
                      key: "subprocess",
                      label: "版本与映射",
                      forceRender: true,
                      children: (
                        <Form.Item
                          name="subprocess"
                          rules={[
                            {
                              validator: async (
                                _,
                                binding: WorkflowNode["subprocess"],
                              ) => {
                                if (!binding?.versionId)
                                  throw new Error("请选择子流程发布版本");
                                const version = await api<{
                                  fields: WorkflowField[];
                                }>(
                                  `/operations/workflows/subprocess-versions/${binding.versionId}`,
                                );
                                const issues = subprocessMappingIssues(
                                  binding,
                                  fields,
                                  version.fields,
                                  form.getFieldValue("readable") ?? [],
                                  form.getFieldValue("writable") ?? [],
                                );
                                if (issues.length) throw new Error(issues[0]);
                              },
                            },
                          ]}
                        >
                          <WorkflowSubprocessEditor
                            fields={fields}
                            readable={readable}
                            writable={writable}
                          />
                        </Form.Item>
                      ),
                    },
                  ]
                : []),
              ...(type === "APPROVAL" ||
              type === "COPY" ||
              type === "SUBPROCESS"
                ? [
                    {
                      key: "fields",
                      label: "字段权限",
                      forceRender: true,
                      children: (
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
                      ),
                    },
                  ]
                : []),
              ...(type === "CONDITION"
                ? [
                    {
                      key: "conditions",
                      label: focusedBranch ? "分支条件" : "分支规则",
                      forceRender: true,
                      children: (
                        <Form.List name="conditions">
                          {(rows, { add, remove }) => (
                            <div className="condition-rules">
                              {structured ? (
                                <>
                                  {focusedBranch ? (
                                    rows
                                      .filter((row) => row.name === branchIndex)
                                      .map(renderCondition)
                                  ) : (
                                    <Tabs
                                      activeKey={activeRule}
                                      onChange={setActiveRule}
                                      items={rows.map((row) => ({
                                        key: String(row.name),
                                        label: `条件${row.name + 1}`,
                                        forceRender: true,
                                        children: renderCondition(row),
                                      }))}
                                    />
                                  )}
                                  <span className="muted">
                                    按条件顺序匹配第一条满足的分支；均不满足时进入默认分支。
                                  </span>
                                </>
                              ) : (
                                <>
                                  {rows.map((row) => (
                                    <div key={row.key}>
                                      {renderCondition(row)}
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
                                </>
                              )}
                            </div>
                          )}
                        </Form.List>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
    </FormModal>
  );
}
