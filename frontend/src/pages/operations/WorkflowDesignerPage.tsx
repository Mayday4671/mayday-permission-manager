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
import { Save, Send } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowSpec,
} from "../../types/workflow";
import { WorkflowCanvas } from "../../components/workflow/WorkflowCanvas";
import { WorkflowDiagram } from "../../components/workflow/WorkflowDiagram";
import { WorkflowFormDesigner } from "../../components/workflow/WorkflowFormDesigner";
import {
  validateWorkflowFields,
  validateWorkflowFormReferences,
} from "../../lib/workflowForm";
import "../../workflow.css";
interface Simulation {
  valid: boolean;
  path: SimulationStep[];
}
interface SimulationResult {
  /** 结果仅属于发起时的输入、发起人、模型与弹窗会话，不能复用到新的上下文。 */
  generation: number;
  data: Simulation;
}
interface SimulationStep {
  id: string;
  name: string;
  type: string;
  approvers: { id: number; name: string }[];
  branch?: string | null;
  childVersionId?: number;
  childPath?: SimulationStep[];
}
/** 嵌套模拟按真实并行支路与固定子版本展示，不将子流程当作一行空壳节点。 */
function SimulationPath({ steps }: { steps: SimulationStep[] }) {
  return (
    <ol>
      {steps.map((node, index) => (
        <li key={`${node.id}:${index}`}>
          <b>{node.name}</b>
          {node.branch && <Tag>{node.branch}</Tag>}
          {!!node.approvers.length && (
            <span>
              {" "}
              · {node.approvers.map((person) => person.name).join("、")}
            </span>
          )}
          {node.childPath && (
            <>
              <span> · 固定版本 #{node.childVersionId}</span>
              <SimulationPath steps={node.childPath} />
            </>
          )}
        </li>
      ))}
    </ol>
  );
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
  const [node, setNode] = useState<WorkflowNode | null>(null),
    [existing, setExisting] = useState(false);
  const [simulating, setSimulating] = useState(false),
    [result, setResult] = useState<SimulationResult | null>(null),
    [simulateForm] = Form.useForm<{
      applicantId?: number;
      values: Record<string, unknown>;
    }>();
  // 观察完整表单，覆盖人员切换、明细/附件和计算控件的程序赋值，不能只依赖文本输入事件。
  const simulationInputs = Form.useWatch((values) => values, {
    form: simulateForm,
    preserve: true,
  });
  const simulationFingerprint = JSON.stringify({
    id,
    schema: spec,
    inputs: simulationInputs ?? {},
    open: simulating,
  });
  const simulationContext = useRef({
    fingerprint: "",
    generation: 0,
    request: 0,
  });
  // 同步更新异步回调读取的最新上下文；A→B→A 也产生新代际，旧 A 响应不能复活。
  // 渲染时同时按代际过滤结果，避免 useEffect 清理前的一帧继续显示旧“校验通过”。
  if (simulationContext.current.fingerprint !== simulationFingerprint)
    simulationContext.current = {
      ...simulationContext.current,
      fingerprint: simulationFingerprint,
      generation: simulationContext.current.generation + 1,
    };
  useEffect(() => setResult(null), [simulationFingerprint]);
  const editable = can("workflows:update") && !saving;
  const savingRef = useRef(false);
  const lastHistoryKey = useRef<string | undefined>(undefined);
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
      lastHistoryKey.current = undefined;
    }
  }, [query.data, id]);
  useUnsavedChanges(dirty);
  /** 本地编辑使上一次模拟失效，防止将旧路径结果当作新草稿的执行结论。 */
  const update = (next: WorkflowSpec, historyKey?: string) => {
    if (
      !editable ||
      savingRef.current ||
      JSON.stringify(next) === JSON.stringify(spec)
    )
      return;
    // 同一字段连续输入合并为一次撤销；结构调整、切换字段与流程编辑仍分别记录。
    if (spec && (!historyKey || historyKey !== lastHistoryKey.current))
      setUndoHistory((history) => [...history.slice(-29), spec]);
    lastHistoryKey.current = historyKey;
    setRedoHistory([]);
    setSpec(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(record?.schema));
    setResult(null);
  };
  /** 撤销与重做仅恢复未保存的本地草稿，保存版本和在途快照仍由服务端维护。 */
  const restore = (redo = false) => {
    const history = redo ? redoHistory : undoHistory;
    const next = history.at(-1);
    if (!editable || savingRef.current || !spec || !next) return;
    lastHistoryKey.current = undefined;
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
    if (!record || !spec || savingRef.current) return;
    // 发布是独立权限：仅发布账号可发布已保存草稿，不能因此获得编辑或保存权限。
    if (publish ? !can("workflows:publish") : !can("workflows:update")) return;
    if (dirty && !can("workflows:update")) {
      message.error("需要先由有编辑权限的成员保存草稿");
      return;
    }
    const fieldErrors = [
      ...validateWorkflowFields(spec.fields),
      ...validateWorkflowFormReferences(spec),
    ];
    if (fieldErrors.length) {
      setTab("fields");
      message.error(fieldErrors[0].message);
      return;
    }
    savingRef.current = true;
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
        lastHistoryKey.current = undefined;
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
      savingRef.current = false;
      setSaving(false);
    }
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
        <ConfigProvider componentDisabled={saving}>
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
              onChange={(nextTab) => {
                lastHistoryKey.current = undefined;
                setTab(nextTab);
              }}
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
                    <div className="designer-form-body">
                      <WorkflowFormDesigner
                        key={record.id}
                        spec={spec}
                        editable={editable}
                        formName={record.name}
                        onChange={update}
                        canUndo={undoHistory.length > 0}
                        canRedo={redoHistory.length > 0}
                        onUndo={() => restore()}
                        onRedo={() => restore(true)}
                      />
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
                if (!editable || savingRef.current)
                  throw new Error("当前暂不可编辑流程，请等待保存完成");
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
                  next:
                    item.type === "END" || item.type === "PARALLEL"
                      ? undefined
                      : item.next,
                  branches:
                    item.type === "PARALLEL"
                      ? item.branches
                      : item.type === "CONDITION"
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
              onSubmit={async (values) => {
                const generation = simulationContext.current.generation;
                const request = ++simulationContext.current.request;
                // 当前请求失败也必须保持无结果，不能把上一次的成功路径当成本次校验结论。
                setResult(null);
                const data = await api<Simulation>(
                  "/operations/workflows/simulate",
                  {
                    method: "POST",
                    body: jsonBody({
                      schema: spec,
                      applicantId: values.applicantId,
                      values: encodeWorkflowValues(
                        spec.fields,
                        values.values ?? {},
                      ),
                    }),
                  },
                );
                if (
                  simulationContext.current.generation === generation &&
                  simulationContext.current.request === request
                )
                  setResult({ generation, data });
              }}
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
                  <Alert
                    type="info"
                    title="模拟按当前填写值展开条件、全部并行支路及固定子流程。正式审批中修改的字段可能改变后续路线，模拟不会预先替审批人作决定。"
                  />
                  {result?.generation ===
                    simulationContext.current.generation && (
                    <div className="simulation-result">
                      <Alert
                        type={result.data.valid ? "success" : "error"}
                        title={
                          result.data.valid ? "模型校验通过" : "模型校验未通过"
                        }
                      />
                      {result.data.valid && (
                        <SimulationPath steps={result.data.path} />
                      )}
                    </div>
                  )}
                </>
              )}
            </FormModal>
          </div>
        </ConfigProvider>
      )}
    </QueryState>
  );
}
