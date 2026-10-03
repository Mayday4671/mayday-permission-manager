import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  ConfigProvider,
  Empty,
  Form,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
} from "antd";
import { Plus, Save, Send } from "lucide-react";
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
import { WorkflowCanvas } from "../../components/workflow/WorkflowCanvas";
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
/**
 * 设计器独立页签：线路上选择节点类型即插入，节点弹窗只配置业务属性。
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
    [tab, setTab] = useState("nodes");
  const [undoHistory, setUndoHistory] = useState<WorkflowSpec[]>([]),
    [redoHistory, setRedoHistory] = useState<WorkflowSpec[]>([]),
    [branchIndex, setBranchIndex] = useState<number | null>(null),
    [repairing, setRepairing] = useState(false),
    [viewingConnections, setViewingConnections] = useState(false),
    [legacyEditing, setLegacyEditing] = useState(false);
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
      setUndoHistory([]);
      setRedoHistory([]);
    }
  }, [query.data, id]);
  useUnsavedChanges(dirty);
  /** 本地编辑使上一次模拟失效，防止将旧路径结果当作新草稿的执行结论。 */
  const update = (next: WorkflowSpec) => {
    if (!editable) return;
    if (spec) setUndoHistory((history) => [...history.slice(-29), spec]);
    setRedoHistory([]);
    setSpec(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(record?.schema));
    setResult(null);
  };
  /** 撤销与重做仅恢复未保存的本地草稿，保存版本和在途快照仍由服务端维护。 */
  const restore = (redo = false) => {
    const history = redo ? redoHistory : undoHistory;
    const next = history.at(-1);
    if (!editable || !spec || !next) return;
    if (redo) {
      setRedoHistory(history.slice(0, -1));
      setUndoHistory((items) => [...items.slice(-29), spec]);
    } else {
      setUndoHistory(history.slice(0, -1));
      setRedoHistory((items) => [...items.slice(-29), spec]);
    }
    setSpec(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(record?.schema));
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
                    <WorkflowCanvas
                      spec={spec}
                      editable={editable}
                      personOptions={record.personOptions}
                      onChange={update}
                      onEditNode={(selected, index) => {
                        if (!editable) return;
                        setExisting(true);
                        setLegacyEditing(false);
                        setBranchIndex(index);
                        setNode(selected);
                      }}
                      onRepairConnections={() => setRepairing(true)}
                      onViewConnections={() => setViewingConnections(true)}
                      onEditApplicant={() => setTab("base")}
                      onUndo={() => restore()}
                      onRedo={() => restore(true)}
                      canUndo={undoHistory.length > 0}
                      canRedo={redoHistory.length > 0}
                    />
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
            structured={!legacyEditing}
            branchIndex={branchIndex}
            personOptions={record.personOptions}
            node={node}
            existing={existing}
            nodes={spec.nodes}
            fields={spec.fields}
            onClose={() => {
              setNode(null);
              setBranchIndex(null);
            }}
            onSave={(next) => {
              if (!editable) throw new Error("当前账号没有流程编辑权限");
              if (!spec.nodes.some((item) => item.id === next.id))
                throw new Error("节点已变化，请重新打开配置");
              change(
                "nodes",
                spec.nodes.map((item) => (item.id === next.id ? next : item)),
              );
              setNode(null);
              setBranchIndex(null);
            }}
          />
          {/* 仅损坏的旧草稿显示此恢复入口，日常编排由线路加号自动维护连接。 */}
          <Modal
            title="流程完整连线"
            open={viewingConnections}
            centered
            width={1000}
            footer={null}
            onCancel={() => setViewingConnections(false)}
          >
            <WorkflowDiagram
              startNodeId={spec.startNodeId}
              items={spec.nodes.map((item) => ({
                id: item.id,
                name: item.name,
                type: item.type,
                next: item.type === "END" ? undefined : item.next,
                branches:
                  item.type === "CONDITION"
                    ? item.conditions?.map((rule) => rule.next)
                    : undefined,
              }))}
            />
          </Modal>
          <Modal
            title="修复旧连线"
            open={repairing && editable}
            centered
            onCancel={() => setRepairing(false)}
            footer={<Button onClick={() => setRepairing(false)}>完成</Button>}
          >
            <Form layout="vertical">
              <Form.Item label="流程入口">
                <Select
                  value={spec.startNodeId}
                  options={spec.nodes
                    .filter((item) => item.type !== "END")
                    .map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(value) => change("startNodeId", value)}
                />
              </Form.Item>
              <Form.Item label="检查旧节点的后续出口">
                <Space wrap>
                  {spec.nodes
                    .filter((item) => item.type !== "END")
                    .map((item) => (
                      <Button
                        key={item.id}
                        onClick={() => {
                          setRepairing(false);
                          setLegacyEditing(true);
                          setExisting(true);
                          setBranchIndex(null);
                          setNode(item);
                        }}
                      >
                        {item.name}
                      </Button>
                    ))}
                </Space>
              </Form.Item>
            </Form>
          </Modal>
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
