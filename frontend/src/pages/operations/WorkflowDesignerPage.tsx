import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  ConfigProvider,
  Empty,
  Form,
  Select,
  Space,
  Tabs,
  Tag,
} from "antd";
import {
  ArrowRight,
  GitBranch,
  Plus,
  Save,
  Send,
  UserRound,
  Square,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FieldEditor } from "../../components/workflow/FieldEditor";
import {
  NodeEditor,
  WorkflowRoleSelect,
} from "../../components/workflow/NodeEditor";
import {
  WorkflowFields,
  encodeWorkflowValues,
} from "../../components/WorkflowFields";
import { UserSelect } from "../../components/LookupSelect";
import { DepartmentSelect } from "../../components/DepartmentSelect";
import { FormModal } from "../../components/FormModal";
import { QueryState } from "../../components/shared";
import { useAuth } from "../../lib/auth";
import { usePageState } from "../../lib/workspace";
import { useUnsavedChanges } from "../../lib/useUnsavedChanges";
import { api, jsonBody } from "../../lib/api";
import {
  fieldNames,
  type WorkflowDefinition,
  type WorkflowField,
  type WorkflowNode,
  type WorkflowSpec,
} from "../../types/workflow";
import { WorkflowDiagram } from "../../components/workflow/WorkflowDiagram";
import { WorkflowFormDesigner } from "../../components/workflow/WorkflowFormDesigner";
import "../../workflow.css";
interface Simulation {
  valid: boolean;
  path: {
    id: string;
    name: string;
    type: string;
    approvers: { id: number; name: string }[];
  }[];
}
const nodeLabels = {
  APPROVAL: "审批节点",
  COPY: "抄送",
  CONDITION: "条件分支",
  END: "结束",
};
/**
 * 设计器独立页签，字段与节点均通过弹窗编辑；同时提供可键盘操作的节点列表。
 * 本地草稿不写浏览器存储，保存/发布均携带版本，发布前由同一运行引擎验证模型和人员引用。
 */
export function WorkflowDesignerPage() {
  const { can } = useAuth(),
    { message, modal } = App.useApp(),
    navigate = useNavigate(),
    client = useQueryClient();
  const [params] = useSearchParams();
  const queryId = Number(params.get("id"));
  const [savedId, setSavedId] = usePageState<number | null>(
    "definitionId",
    Number.isSafeInteger(queryId) && queryId > 0 ? queryId : null,
  );
  const id = Number.isSafeInteger(queryId) && queryId > 0 ? queryId : savedId;
  const query = useQuery({
    queryKey: ["workflows", "definition", id],
    queryFn: () => api<WorkflowDefinition>(`/operations/workflows/${id}`),
    enabled: id !== null,
  });
  const [record, setRecord] = useState<WorkflowDefinition | null>(null),
    [spec, setSpec] = useState<WorkflowSpec | null>(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const loadedId = useRef<number | null>(null),
    [tab, setTab] = useState("nodes"),
    [listMode, setListMode] = useState(false);
  const [insertAfter, setInsertAfter] = useState<string | null>(null);
  const [field, setField] = useState<WorkflowField | null>(null),
    [node, setNode] = useState<WorkflowNode | null>(null),
    [existing, setExisting] = useState(false);
  const [simulating, setSimulating] = useState(false),
    [result, setResult] = useState<Simulation | null>(null),
    [simulateForm] = Form.useForm<{
      applicantId?: number;
      values: Record<string, unknown>;
    }>();
  const editable = can("workflows:update");
  useEffect(() => {
    if (id) setSavedId(id);
  }, [id]);
  useEffect(() => {
    if (query.data && loadedId.current !== id) {
      loadedId.current = id;
      setRecord(query.data);
      setSpec(query.data.schema);
      setDirty(false);
    }
  }, [query.data, id]);
  useUnsavedChanges(dirty);
  /** 本地编辑使上一次模拟失效，防止将旧路径结果当作新草稿的执行结论。 */
  const update = (next: WorkflowSpec) => {
    setSpec(next);
    setDirty(true);
    setResult(null);
  };
  const change = <K extends keyof WorkflowSpec>(
    key: K,
    value: WorkflowSpec[K],
  ) => {
    if (spec) update({ ...spec, [key]: value });
  };
  const leave = () => navigate("/admin/workflows");
  /** 先保存再以返回版本发布；保存失败不继续发布，发布失败保留已保存草稿供继续修正。 */
  const save = async (publish = false) => {
    if (!record || !spec) return;
    setSaving(true);
    try {
      let saved = record;
      if (dirty) {
        saved = await api<WorkflowDefinition>(`/operations/workflows/${id}`, {
          method: "PUT",
          body: jsonBody({ ...record, schema: spec, version: record.version }),
        });
        setRecord(saved);
        setSpec(saved.schema);
        setDirty(false);
      }
      if (publish) {
        saved = await api<WorkflowDefinition>(
          `/operations/workflows/${id}/publish`,
          { method: "POST", body: jsonBody({ version: saved.version }) },
        );
        setRecord(saved);
      }
      void client.invalidateQueries({ queryKey: ["workflows"] });
      void client.invalidateQueries({ queryKey: ["workflow-options"] });
      message.success(publish ? "新版本已发布" : "流程草稿已保存");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  /** ID 与显示名称分离且不复用当前图中的编号，已有节点名称变化不会破坏边引用。 */
  const newId = (prefix: string, used: string[]) => {
    let suffix = 1;
    while (used.includes(prefix + suffix)) suffix++;
    return prefix + suffix;
  };
  if (!id)
    return (
      <div className="panel designer-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="请先选择要设计的流程"
        />
        <Button type="primary" onClick={() => navigate("/admin/workflows")}>
          打开流程定义
        </Button>
      </div>
    );
  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      retry={() => void query.refetch()}
    >
      {record && spec && (
        <div className="workflow-designer">
          <div className="designer-toolbar">
            <div>
              <Button onClick={leave}>返回列表</Button>
              <strong>{record.name}</strong>
              <Tag>
                {record.publishedVersion
                  ? "已发布版本 " + record.publishedVersion
                  : "未发布"}
              </Tag>
              {dirty && <span className="dirty-label">未保存</span>}
            </div>
            <Space wrap>
              <Button
                onClick={() => {
                  simulateForm.resetFields();
                  setResult(null);
                  setSimulating(true);
                }}
              >
                预览与模拟
              </Button>
              {editable && (
                <Button
                  loading={saving}
                  disabled={!dirty}
                  icon={<Save size={15} />}
                  onClick={() => void save()}
                >
                  保存草稿
                </Button>
              )}
              {can("workflows:publish") && (
                <Button
                  type="primary"
                  loading={saving}
                  icon={<Send size={15} />}
                  disabled={dirty && !editable}
                  onClick={() =>
                    modal.confirm({
                      title: "发布这份流程？",
                      content:
                        "将校验字段、所有分支和审批人引用；已有申请保持原版本。",
                      centered: true,
                      okText: "发布",
                      onOk: () => save(true),
                    })
                  }
                >
                  发布版本
                </Button>
              )}
            </Space>
          </div>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: "base",
                label: "基础设置",
                children: (
                  <div className="designer-settings">
                    <ConfigProvider componentDisabled={!editable}>
                      <Form layout="vertical">
                        <Form.Item label="流程编码">
                          <span>{record.code}</span>
                        </Form.Item>
                        <Form.Item label="业务类型">
                          <span>
                            {record.businessType === "CONTENT"
                              ? "内容发布审核"
                              : "通用审批"}
                          </span>
                        </Form.Item>
                        <Form.Item label="发起范围">
                          <Select
                            value={spec.applicantType}
                            onChange={(value) =>
                              update({
                                ...spec,
                                applicantType: value,
                                applicantIds: [],
                              })
                            }
                            options={[
                              { value: "ALL", label: "全部有发起权限的账号" },
                              { value: "USERS", label: "指定人员" },
                              { value: "ROLES", label: "指定角色" },
                              { value: "DEPARTMENTS", label: "指定部门" },
                            ]}
                          />
                        </Form.Item>
                        {spec.applicantType !== "ALL" && (
                          <Form.Item label="允许发起的对象">
                            {spec.applicantType === "USERS" ? (
                              <UserSelect
                                initialOptions={record.personOptions}
                                mode="multiple"
                                value={spec.applicantIds}
                                onChange={(value) =>
                                  change("applicantIds", value as number[])
                                }
                              />
                            ) : spec.applicantType === "ROLES" ? (
                              <WorkflowRoleSelect
                                value={spec.applicantIds}
                                onChange={(value) =>
                                  change("applicantIds", value)
                                }
                              />
                            ) : (
                              <DepartmentSelect
                                value={spec.applicantIds}
                                onChange={(value) =>
                                  change("applicantIds", value)
                                }
                              />
                            )}
                          </Form.Item>
                        )}
                      </Form>
                    </ConfigProvider>
                  </div>
                ),
              },
              {
                key: "fields",
                label: `表单设计 (${spec.fields.length})`,
                children: (
                  <div className="designer-body">
                    <div className="designer-section-tools">
                      <span>字段顺序即申请表单显示顺序</span>
                      {editable && (
                        <Button
                          icon={<Plus size={15} />}
                          disabled={spec.fields.length >= 40}
                          onClick={() => {
                            setExisting(false);
                            setField({
                              id: newId(
                                "field",
                                spec.fields.map((f) => f.id),
                              ),
                              label: "新字段",
                              type: "TEXT",
                              width: 24,
                              required: false,
                              maxLength: 2000,
                            });
                          }}
                        >
                          添加字段
                        </Button>
                      )}
                    </div>
                    <WorkflowFormDesigner
                      fields={spec.fields}
                      editable={editable}
                      onAdd={(type) => {
                        setExisting(false);
                        setField({
                          id: newId(
                            "field",
                            spec.fields.map((f) => f.id),
                          ),
                          label: fieldNames[type],
                          type,
                          width: type === "DETAILS" ? 24 : 12,
                          required: false,
                          columns:
                            type === "DETAILS"
                              ? [
                                  {
                                    id: "item",
                                    label: "项目",
                                    type: "TEXT",
                                    required: true,
                                  },
                                  {
                                    id: "amount",
                                    label: "金额",
                                    type: "MONEY",
                                    required: true,
                                    min: 0,
                                  },
                                ]
                              : undefined,
                          maxRows: type === "DETAILS" ? 20 : undefined,
                        });
                      }}
                      onEdit={(field) => {
                        setExisting(true);
                        setField(field);
                      }}
                      onMove={(index, target) => {
                        const next = [...spec.fields];
                        [next[index], next[target]] = [
                          next[target],
                          next[index],
                        ];
                        change("fields", next);
                      }}
                      onRemove={(field) =>
                        modal.confirm({
                          title: "移除字段？",
                          content:
                            "同时清理节点读写引用；分支条件需要重新配置。",
                          centered: true,
                          onOk: () =>
                            update({
                              ...spec,
                              fields: spec.fields.filter(
                                (item) => item.id !== field.id,
                              ),
                              nodes: spec.nodes.map((node) => ({
                                ...node,
                                readable: node.readable?.filter(
                                  (id) => id !== field.id,
                                ),
                                writable: node.writable?.filter(
                                  (id) => id !== field.id,
                                ),
                              })),
                            }),
                        })
                      }
                    />
                    {!spec.fields.length && (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="暂无表单字段"
                      />
                    )}
                  </div>
                ),
              },
              {
                key: "nodes",
                label: "流程设计",
                children: (
                  <div className="designer-body">
                    <div className="designer-section-tools">
                      <Space>
                        <span>起始节点</span>
                        <Select
                          aria-label="起始节点"
                          disabled={!editable}
                          value={spec.startNodeId}
                          onChange={(value) => change("startNodeId", value)}
                          options={spec.nodes.map((n) => ({
                            value: n.id,
                            label: n.name,
                          }))}
                          style={{ width: 170 }}
                        />
                      </Space>
                      <Space>
                        <Button onClick={() => setListMode(!listMode)}>
                          {listMode ? "图形视图" : "节点列表"}
                        </Button>
                        {editable && (
                          <Button
                            icon={<Plus size={15} />}
                            disabled={spec.nodes.length >= 40}
                            onClick={() => {
                              setInsertAfter(null);
                              setExisting(false);
                              setNode({
                                id: newId(
                                  "node",
                                  spec.nodes.map((n) => n.id),
                                ),
                                name: "新审批节点",
                                type: "APPROVAL",
                                source: "USERS",
                                assigneeIds: [],
                                mode: "ALL",
                                next: "end",
                                readable: spec.fields.map((f) => f.id),
                                writable: [],
                                actions: [
                                  "APPROVE",
                                  "REJECT",
                                  "RETURN",
                                  "COMMENT",
                                ],
                                conditions: [],
                              });
                            }}
                          >
                            添加节点
                          </Button>
                        )}
                      </Space>
                    </div>
                    {!listMode && (
                      <WorkflowDiagram
                        startNodeId={spec.startNodeId}
                        items={spec.nodes.map((node) => ({
                          ...node,
                          branches: node.conditions?.map((rule) => rule.next),
                          description:
                            node.type === "END"
                              ? undefined
                              : node.type === "CONDITION"
                                ? `${node.conditions?.length ?? 0} 条分支规则`
                                : node.source === "DEPARTMENT_LEADER"
                                  ? "部门负责人"
                                  : `${node.assigneeIds?.length ?? 0} ${node.source === "ROLES" ? "个角色" : "人"} · ${node.type === "COPY" ? "抄送" : node.mode === "SERIAL" ? "顺签" : node.mode === "ALL" ? "会签" : "或签"}`,
                        }))}
                        onInsert={
                          editable
                            ? (id) => {
                                if (spec.nodes.length >= 40) {
                                  message.warning("最多40个节点");
                                  return;
                                }
                                setInsertAfter(id);
                                setExisting(false);
                                setNode({
                                  id: newId(
                                    "node",
                                    spec.nodes.map((n) => n.id),
                                  ),
                                  name: "新审批节点",
                                  type: "APPROVAL",
                                  source: "USERS",
                                  assigneeIds: [],
                                  mode: "ALL",
                                  next: spec.nodes.find((n) => n.id === id)
                                    ?.next,
                                  readable: spec.fields.map((f) => f.id),
                                  writable: [],
                                  actions: [
                                    "APPROVE",
                                    "REJECT",
                                    "RETURN",
                                    "COMMENT",
                                  ],
                                  conditions: [],
                                });
                              }
                            : undefined
                        }
                        onEdit={
                          editable
                            ? (id) => {
                                setExisting(true);
                                setNode(
                                  spec.nodes.find((node) => node.id === id) ??
                                    null,
                                );
                              }
                            : undefined
                        }
                        onConnect={
                          editable
                            ? (source, target, branch) =>
                                change(
                                  "nodes",
                                  spec.nodes.map((node) =>
                                    node.id !== source
                                      ? node
                                      : branch === null
                                        ? { ...node, next: target }
                                        : {
                                            ...node,
                                            conditions: node.conditions?.map(
                                              (rule, index) =>
                                                index === branch
                                                  ? { ...rule, next: target }
                                                  : rule,
                                            ),
                                          },
                                  ),
                                )
                            : undefined
                        }
                      />
                    )}
                    {listMode && (
                      <div className="workflow-node-list">
                        {spec.nodes.map((n) => (
                          <div
                            key={n.id}
                            className={"workflow-node " + n.type.toLowerCase()}
                          >
                            <div className="workflow-node-head">
                              <span>
                                {n.type === "APPROVAL" ? (
                                  <UserRound size={17} />
                                ) : n.type === "CONDITION" ? (
                                  <GitBranch size={17} />
                                ) : (
                                  <Square size={15} />
                                )}
                              </span>
                              <strong>{n.name}</strong>
                              <Tag>{nodeLabels[n.type]}</Tag>
                              {spec.startNodeId === n.id && (
                                <Tag color="blue">起点</Tag>
                              )}
                            </div>
                            {n.type === "APPROVAL" && (
                              <div className="workflow-node-info">
                                {n.source === "DEPARTMENT_LEADER"
                                  ? "部门负责人"
                                  : n.source === "ROLES"
                                    ? "指定角色 · " +
                                      (n.assigneeIds?.length ?? 0) +
                                      " 项"
                                    : "指定人员 · " +
                                      (n.assigneeIds?.length ?? 0) +
                                      " 人"}
                                <span>
                                  {n.mode === "ALL"
                                    ? "会签"
                                    : n.mode === "SERIAL"
                                      ? "顺签"
                                      : "或签"}
                                </span>
                              </div>
                            )}
                            <div className="workflow-exits">
                              {n.conditions?.map((rule, index) => (
                                <div key={index}>
                                  <GitBranch size={13} />
                                  <span>
                                    {spec.fields.find(
                                      (f) => f.id === rule.field,
                                    )?.label ?? rule.field}{" "}
                                    {
                                      {
                                        EQ: "=",
                                        NE: "≠",
                                        GT: ">",
                                        GE: "≥",
                                        LT: "<",
                                        LE: "≤",
                                        CONTAINS: "包含",
                                      }[rule.operator]
                                    }{" "}
                                    {rule.value}
                                  </span>
                                  <ArrowRight size={13} />
                                  {spec.nodes.find((x) => x.id === rule.next)
                                    ?.name ?? "出口失效"}
                                </div>
                              ))}
                              {n.type !== "END" && (
                                <div>
                                  <span>
                                    {n.type === "CONDITION"
                                      ? "默认"
                                      : "下一节点"}
                                  </span>
                                  <ArrowRight size={13} />
                                  {spec.nodes.find((x) => x.id === n.next)
                                    ?.name ?? "未连接"}
                                </div>
                              )}
                            </div>
                            <div className="workflow-node-footer">
                              <code>{n.id}</code>
                              {editable && (
                                <Space>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      setExisting(true);
                                      setNode(n);
                                    }}
                                  >
                                    配置节点
                                  </Button>
                                  <Button
                                    size="small"
                                    danger
                                    onClick={() =>
                                      modal.confirm({
                                        title: "移除这个节点？",
                                        content:
                                          "引用它的出口需要重新连接，发布时会检查所有引用。",
                                        centered: true,
                                        onOk: () =>
                                          change(
                                            "nodes",
                                            spec.nodes.filter(
                                              (x) => x.id !== n.id,
                                            ),
                                          ),
                                      })
                                    }
                                  >
                                    移除
                                  </Button>
                                </Space>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "rules",
                label: "其他设置",
                children: (
                  <div className="designer-settings">
                    <ConfigProvider componentDisabled={!editable}>
                      <Space orientation="vertical" size={22}>
                        <Checkbox
                          checked={spec.allowSelfApproval}
                          onChange={(e) =>
                            change("allowSelfApproval", e.target.checked)
                          }
                        >
                          允许申请人审批自己的申请
                        </Checkbox>
                        <Checkbox
                          checked={spec.allowRepeatApproval}
                          onChange={(e) =>
                            change("allowRepeatApproval", e.target.checked)
                          }
                        >
                          允许同一审批人出现在多个审批节点
                        </Checkbox>
                        <Checkbox
                          checked={spec.allowWithdraw}
                          onChange={(e) =>
                            change("allowWithdraw", e.target.checked)
                          }
                        >
                          允许申请人在结束前撤回
                        </Checkbox>
                      </Space>
                    </ConfigProvider>
                    <p className="muted">
                      无有效审批人、循环和未连接的分支会阻止提交或发布；不会自动通过。
                    </p>
                  </div>
                ),
              },
            ]}
          />
          <FieldEditor
            field={field}
            existing={existing}
            onClose={() => setField(null)}
            onSave={(next) => {
              if (!existing && spec.fields.some((f) => f.id === next.id))
                throw new Error("字段 ID 已存在");
              change(
                "fields",
                existing
                  ? spec.fields.map((f) => (f.id === next.id ? next : f))
                  : [...spec.fields, next],
              );
              setField(null);
            }}
          />
          <NodeEditor
            personOptions={record.personOptions}
            node={node}
            existing={existing}
            nodes={spec.nodes}
            fields={spec.fields}
            onClose={() => setNode(null)}
            onSave={(next) => {
              if (!existing && spec.nodes.some((n) => n.id === next.id))
                throw new Error("节点 ID 已存在");
              change(
                "nodes",
                existing
                  ? spec.nodes.map((n) => (n.id === next.id ? next : n))
                  : [
                      ...spec.nodes.map((n) =>
                        n.id === insertAfter ? { ...n, next: next.id } : n,
                      ),
                      next,
                    ],
              );
              setNode(null);
            }}
          />
          <FormModal
            confirmDiscard={false}
            title="表单预览与流程模拟"
            open={simulating}
            form={simulateForm}
            onCancel={() => setSimulating(false)}
            width={850}
            okText="校验并模拟"
            onSubmit={async (values) =>
              setResult(
                await api<Simulation>("/operations/workflows/simulate", {
                  method: "POST",
                  body: jsonBody({
                    schema: spec,
                    applicantId: values.applicantId,
                    values: encodeWorkflowValues(
                      spec.fields,
                      values.values ?? {},
                    ),
                  }),
                }),
              )
            }
          >
            {simulating && (
              <>
                {can("users:view") && (
                  <Form.Item
                    name="applicantId"
                    label="模拟发起人"
                    extra="留空使用当前账号。模拟不会创建申请或发送通知。"
                  >
                    <UserSelect />
                  </Form.Item>
                )}
                <WorkflowFields fields={spec.fields} />
                {result && (
                  <div className="simulation-result">
                    <Alert type="success" title="模型校验通过" />
                    <ol>
                      {result.path.map((n) => (
                        <li key={n.id}>
                          <b>{n.name}</b>
                          {n.approvers.length > 0 && (
                            <span>
                              {" "}
                              · {n.approvers.map((a) => a.name).join("、")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
          </FormModal>
        </div>
      )}
    </QueryState>
  );
}
