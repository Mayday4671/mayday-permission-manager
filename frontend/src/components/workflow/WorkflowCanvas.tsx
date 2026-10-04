import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Popover, Space, Tooltip } from "antd";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronRight,
  GitBranch,
  Minus,
  Scan,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { WorkflowNode, WorkflowSpec } from "../../types/workflow";
import { conditionSummary as groupedConditionSummary } from "../../lib/workflowConditions";
import {
  addWorkflowBranch,
  deleteWorkflowBranch,
  findWorkflowConditionJoin,
  insertWorkflowNode,
  insertWorkflowNodeAfterBranches,
  moveWorkflowBranch,
  removeWorkflowNode,
  type WorkflowEdge,
} from "../../lib/workflowGraph";

type InsertType = "APPROVAL" | "COPY" | "CONDITION";
const insertOptions = [
  { type: "APPROVAL", label: "审批人", icon: UserRound },
  { type: "COPY", label: "抄送人", icon: Bell },
  { type: "CONDITION", label: "条件分支", icon: GitBranch },
] as const;
const operatorNames = {
  EQ: "等于",
  NE: "不等于",
  GT: "大于",
  GE: "大于等于",
  LT: "小于",
  LE: "小于等于",
  CONTAINS: "包含",
};

/** 在线路上选择节点类型，关闭浮层后再编辑业务属性；不会让使用者填写技术出口。 */
function InsertControl({
  label,
  disabled,
  onInsert,
}: {
  label: string;
  disabled: boolean;
  onInsert: (type: InsertType) => void;
}) {
  const [open, setOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 键盘打开加号后直接进入选项；Escape 关闭并返回原线路，避免遍历整份画布才能选择。
  useEffect(() => {
    if (open) optionsRef.current?.querySelector("button")?.focus();
  }, [open]);
  return (
    <Popover
      trigger="click"
      placement="right"
      open={open && !disabled}
      onOpenChange={setOpen}
      content={
        <div
          className="oa-insert-options"
          aria-label="选择流程节点"
          ref={optionsRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {insertOptions.map(({ type, label, icon: Icon }) => (
            <Button
              key={type}
              type="text"
              icon={<Icon size={19} />}
              onClick={() => {
                setOpen(false);
                onInsert(type);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      }
    >
      <Button
        shape="circle"
        type="primary"
        size="small"
        aria-label={label}
        aria-expanded={open && !disabled}
        ref={triggerRef}
        disabled={disabled}
        icon={<Plus size={15} />}
      />
    </Popover>
  );
}

/**
 * 面向业务管理员的纵向 OA 编排：线路加号定点插入，分支自动汇合，节点卡片编辑业务配置。
 * 直接编辑现有扁平模型，不引入虚构的开始/汇合执行类型，也不更改已发布版本和在途快照。
 * 旧草稿的循环、缺失出口和非汇合分支显式显示；渲染有界且不会为显示效果改写数据。
 */
export function WorkflowCanvas({
  spec,
  editable,
  personOptions = [],
  onChange,
  onEditNode,
  onEditApplicant,
  onRepairConnections,
  onViewConnections,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: {
  spec: WorkflowSpec;
  editable: boolean;
  personOptions?: { value: number; label: string }[];
  onChange: (spec: WorkflowSpec) => void;
  onEditNode: (node: WorkflowNode, branchIndex: number | null) => void;
  onEditApplicant?: () => void;
  onRepairConnections?: () => void;
  onViewConnections?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const { message, modal } = App.useApp();
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** 根据真实画布可用面积缩放，长流程仍可恢复 100% 查看，不裁切或改写节点。 */
  const fit = () => {
    const scroll = scrollRef.current,
      stage = stageRef.current;
    if (!scroll || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const ratio = Math.min(
      (scroll.clientWidth - 24) / (bounds.width / zoom),
      (scroll.clientHeight - 24) / (bounds.height / zoom),
    );
    setZoom(Math.min(1, Math.max(0.35, ratio)));
    scroll.scrollTo({ top: 0, left: 0 });
  };
  const visited = new Set<string>();
  let damaged = false;
  let rendered = 0,
    complex = false;
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  damaged = !byId.has(spec.startNodeId) || byId.size !== spec.nodes.length;
  // 可达性独立于界面的展开预算计算，避免把复杂旧图中未展开的节点误报为孤立节点。
  const pending = [spec.startNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const item = byId.get(id);
    if (!item || item.type === "END") continue;
    if (item.next) pending.push(item.next);
    if (item.type === "CONDITION")
      pending.push(...(item.conditions ?? []).map((rule) => rule.next));
  }
  /** 编辑必须基于当前模型；边已变化、达到限额等错误反馈给用户，不默默改其他分支。 */
  const mutate = (operation: () => WorkflowSpec) => {
    try {
      onChange(operation());
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const insert = (operation: () => WorkflowSpec) => {
    try {
      const next = operation();
      const added = next.nodes.find((node) => !byId.has(node.id));
      onChange(next);
      if (added) onEditNode(added, added.type === "CONDITION" ? 0 : null);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const connector = (edge: WorkflowEdge, label: string) => (
    <div
      className="oa-flow-connector"
      key={`edge:${edge.sourceId}:${edge.branchIndex}`}
    >
      {editable && (
        <InsertControl
          label={label}
          disabled={spec.nodes.length >= 40}
          onInsert={(type) =>
            insert(() => insertWorkflowNode(spec, edge, type))
          }
        />
      )}
      <ArrowDown size={12} className="oa-flow-arrow" aria-hidden="true" />
    </div>
  );
  const remove = (node: WorkflowNode) =>
    modal.confirm({
      title:
        node.type === "CONDITION"
          ? "删除这组条件分支？"
          : `删除“${node.name}”？`,
      content:
        node.type === "CONDITION"
          ? "保留默认分支的后续流程，移除其他分支独有的节点；公共后续节点会保留。可用撤销恢复。"
          : node.type === "END"
            ? "仅删除未被任何节点引用的孤立结束节点，可用撤销恢复。"
            : "前后节点会自动接续，可用撤销恢复。已发布流程和在途申请保持原版本。",
      centered: true,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: () => mutate(() => removeWorkflowNode(spec, node.id)),
    });
  const conditionSummary = (node: WorkflowNode, index: number) => {
    const rule = node.conditions?.[index];
    if (rule?.predicate) return groupedConditionSummary(rule);
    const field = spec.fields.find((field) => field.id === rule?.field);
    if (
      !rule ||
      !field ||
      !rule.operator ||
      rule.value == null ||
      rule.value === ""
    )
      return "请设置条件";
    return `${field.label} ${operatorNames[rule.operator]} ${rule.value}`;
  };
  const peopleSummary = (node: WorkflowNode) => {
    if (node.source === "DEPARTMENT_LEADER") return "发起人所在部门负责人";
    const ids = node.assigneeIds ?? [];
    if (!ids.length)
      return node.type === "COPY" ? "请选择抄送人" : "请选择审批人";
    if (node.source === "ROLES") return `${ids.length} 个角色的成员`;
    const labels = ids.map(
      (id) => personOptions.find((person) => person.value === id)?.label,
    );
    return labels.every(Boolean)
      ? labels.join("、")
      : `已选择 ${ids.length} 人`;
  };
  const nodeCard = (node: WorkflowNode) => (
    <div className={`oa-flow-card ${node.type.toLowerCase()}`} key={node.id}>
      <button
        type="button"
        className="oa-node-settings"
        aria-label={`设置${node.type === "COPY" ? "抄送" : "审批"}：${node.name}`}
        disabled={!editable}
        onClick={() => onEditNode(node, null)}
      >
        <span className="oa-node-heading">
          {node.type === "COPY" ? <Bell size={15} /> : <UserRound size={15} />}
          <b>{node.name}</b>
        </span>
        <span
          className={`oa-node-people ${!node.assigneeIds?.length && node.source !== "DEPARTMENT_LEADER" ? "unconfigured" : ""}`}
        >
          {peopleSummary(node)}
          <ChevronRight size={15} />
        </span>
        {node.type === "APPROVAL" && (
          <span className="oa-node-mode">
            {node.mode === "SERIAL"
              ? "依次审批"
              : node.mode === "ANY"
                ? "一人同意即可"
                : "所有人同意"}
          </span>
        )}
      </button>
      {editable && (
        <Tooltip title="删除节点">
          <Button
            type="text"
            size="small"
            className="oa-node-delete"
            aria-label={`删除节点：${node.name}`}
            icon={<Trash2 size={13} />}
            onClick={() => remove(node)}
          />
        </Tooltip>
      )}
    </div>
  );
  /** 路径到共同后续节点即停止；分支内部递归独立追踪，不把合法共享出口误判为循环。 */
  const path = (
    first: string,
    stop: string | null,
    ancestors: Set<string>,
  ): ReactNode => {
    const output: ReactNode[] = [];
    const trail = new Set(ancestors);
    let id: string | undefined = first;
    while (id && id !== stop) {
      // 旧 DAG 的交叉边可能产生指数级路径展开；切到有界连线图，不修改原始业务模型。
      if (rendered++ >= 240) {
        complex = true;
        output.push(
          <span key={`compact:${id}`} className="oa-compact-path">
            复杂交叉路径，详见完整连线
          </span>,
        );
        break;
      }
      if (trail.has(id) || trail.size >= 40) {
        damaged = true;
        output.push(
          <Alert
            key={`cycle:${id}`}
            type="error"
            title="连线存在循环，请修复后发布"
          />,
        );
        break;
      }
      const node = byId.get(id);
      if (!node) {
        damaged = true;
        output.push(
          <Alert
            key={`missing:${id}`}
            type="error"
            title="后续节点已失效，请检查旧草稿"
          />,
        );
        break;
      }
      trail.add(id);
      if (node.type === "END") {
        output.push(
          <div key={id} className="oa-flow-end">
            <span />
            流程结束
          </div>,
        );
        break;
      }
      if (node.type !== "CONDITION") {
        output.push(nodeCard(node));
        if (node.next)
          output.push(
            connector(
              { sourceId: id, branchIndex: null, targetId: node.next },
              `在“${node.name}”后添加节点`,
            ),
          );
        else {
          damaged = true;
          output.push(
            <Alert
              key={`no-exit:${id}`}
              type="error"
              title="该节点没有后续出口"
            />,
          );
        }
        id = node.next;
        continue;
      }
      const join = findWorkflowConditionJoin(spec, node.id);
      if (
        !node.next ||
        !node.conditions?.length ||
        node.conditions.some((rule) => !rule.next)
      )
        damaged = true;
      const branches = [
        ...(node.conditions ?? []).map((rule, index) => ({
          target: rule.next,
          index,
        })),
        { target: node.next, index: null },
      ];
      output.push(
        <section
          key={id}
          className={`oa-condition-group ${join ? "" : "separate-endings"}`}
          aria-label={`条件分支：${node.name}`}
        >
          <div className="oa-condition-toolbar">
            <Tooltip title="从左到右匹配第一个满足的条件，其他情况走默认分支">
              <button
                type="button"
                disabled={!editable}
                onClick={() => onEditNode(node, null)}
              >
                <GitBranch size={14} />
                {node.name}
              </button>
            </Tooltip>
            {editable && (
              <Button
                size="small"
                icon={<Plus size={13} />}
                disabled={(node.conditions?.length ?? 0) >= 10}
                onClick={() => mutate(() => addWorkflowBranch(spec, node.id))}
              >
                添加条件
              </Button>
            )}
            {editable && (
              <Button
                size="small"
                type="text"
                aria-label={`删除分支组：${node.name}`}
                icon={<Trash2 size={13} />}
                onClick={() => remove(node)}
              />
            )}
          </div>
          <div className="oa-flow-branches">
            {branches.map(({ target, index }) => (
              <div className="oa-flow-branch" key={index ?? "default"}>
                <div className="oa-branch-rail top" />
                <div className="oa-branch-rule">
                  <div className="oa-branch-header">
                    <b>{index === null ? "其他情况" : `条件${index + 1}`}</b>
                    {index !== null && editable && (
                      <Space size={0}>
                        <Button
                          type="text"
                          size="small"
                          aria-label={`条件${index + 1}优先级前移`}
                          disabled={index === 0}
                          icon={<ArrowLeft size={12} />}
                          onClick={() =>
                            mutate(() =>
                              moveWorkflowBranch(
                                spec,
                                node.id,
                                index,
                                index - 1,
                              ),
                            )
                          }
                        />
                        <Button
                          type="text"
                          size="small"
                          aria-label={`条件${index + 1}优先级后移`}
                          disabled={
                            index === (node.conditions?.length ?? 1) - 1
                          }
                          icon={<ArrowRight size={12} />}
                          onClick={() =>
                            mutate(() =>
                              moveWorkflowBranch(
                                spec,
                                node.id,
                                index,
                                index + 1,
                              ),
                            )
                          }
                        />
                        <Button
                          type="text"
                          size="small"
                          aria-label={`删除条件${index + 1}`}
                          disabled={(node.conditions?.length ?? 0) <= 1}
                          icon={<Trash2 size={12} />}
                          onClick={() =>
                            modal.confirm({
                              title: `删除条件${index + 1}？`,
                              content:
                                "移除这一条件及它独有的后续节点；公共后续流程会保留。",
                              centered: true,
                              okText: "删除",
                              okButtonProps: { danger: true },
                              onOk: () =>
                                mutate(() =>
                                  deleteWorkflowBranch(spec, node.id, index),
                                ),
                            })
                          }
                        />
                      </Space>
                    )}
                  </div>
                  <button
                    type="button"
                    className={
                      index !== null &&
                      conditionSummary(node, index) === "请设置条件"
                        ? "unconfigured"
                        : ""
                    }
                    disabled={index === null || !editable}
                    onClick={() => onEditNode(node, index)}
                  >
                    {index === null
                      ? "未命中其他条件时进入"
                      : conditionSummary(node, index)}
                    {index !== null && <ChevronRight size={14} />}
                  </button>
                </div>
                {target ? (
                  connector(
                    { sourceId: node.id, branchIndex: index, targetId: target },
                    `在“${node.name}”${index === null ? "默认分支" : `条件${index + 1}`}中添加节点`,
                  )
                ) : (
                  <Alert type="error" title="分支未连接" />
                )}
                {target && path(target, join, trail)}
                {join && <div className="oa-branch-tail" />}
                {join && <div className="oa-branch-rail bottom" />}
              </div>
            ))}
          </div>
          {join && (
            <div className="oa-flow-connector">
              {editable && (
                <InsertControl
                  label={`在“${node.name}”分支汇合后添加节点`}
                  disabled={spec.nodes.length >= 40}
                  onInsert={(type) =>
                    insert(() =>
                      insertWorkflowNodeAfterBranches(spec, node.id, type),
                    )
                  }
                />
              )}
              <ArrowDown
                size={12}
                className="oa-flow-arrow"
                aria-hidden="true"
              />
            </div>
          )}
        </section>,
      );
      id = join ?? undefined;
    }
    return output;
  };
  const route = path(spec.startNodeId, null, new Set());
  const disconnected = spec.nodes.filter((node) => !visited.has(node.id));
  return (
    <div className="oa-workflow-canvas">
      <div className="oa-canvas-tools">
        <Space size={4}>
          {onUndo && (
            <Button
              size="small"
              disabled={!editable || !canUndo}
              onClick={onUndo}
              icon={<Undo2 size={14} />}
            >
              撤销
            </Button>
          )}
          {onRedo && (
            <Button
              size="small"
              disabled={!editable || !canRedo}
              onClick={onRedo}
              icon={<Redo2 size={14} />}
            >
              重做
            </Button>
          )}
        </Space>
        <Space size={4}>
          <Button size="small" onClick={fit} icon={<Scan size={14} />}>
            适应画布
          </Button>
          <Button
            size="small"
            aria-label="缩小流程"
            disabled={zoom <= 0.35}
            icon={<Minus size={14} />}
            onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}
          />
          <Button
            size="small"
            aria-label="恢复流程原始大小"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            size="small"
            aria-label="放大流程"
            disabled={zoom >= 1.3}
            icon={<Plus size={14} />}
            onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}
          />
        </Space>
      </div>
      <div
        className="oa-flow-scroll"
        aria-label="流程编排画布"
        tabIndex={0}
        ref={scrollRef}
      >
        <div className="oa-flow-stage" style={{ zoom }} ref={stageRef}>
          <button
            type="button"
            className="oa-flow-applicant"
            disabled={!editable || !onEditApplicant}
            onClick={onEditApplicant}
          >
            <span>
              <UsersRound size={16} />
              发起人
            </span>
            <b>
              {spec.applicantType === "ALL" ? "所有人" : "按已配置发起范围"}
            </b>
          </button>
          {connector(
            { sourceId: null, branchIndex: null, targetId: spec.startNodeId },
            "在发起人后添加节点",
          )}
          {route}
        </div>
      </div>
      {complex && (
        <Alert
          type="info"
          title="这份旧流程包含较多交叉路径，部分路径已折叠"
          action={
            onViewConnections && (
              <Button size="small" onClick={onViewConnections}>
                查看完整连线
              </Button>
            )
          }
        />
      )}
      {(!!disconnected.length || damaged) && (
        <Alert
          type="warning"
          title={
            disconnected.length
              ? `${disconnected.length} 个旧节点尚未接入流程，发布前需处理`
              : "旧草稿的连线需要修复后才能发布"
          }
          description={
            <Space wrap>
              {disconnected.map((node) => (
                <Space key={node.id} size={0}>
                  <Button
                    size="small"
                    disabled={!editable}
                    onClick={() => onEditNode(node, null)}
                  >
                    {node.name}
                  </Button>
                  {editable && (
                    <Button size="small" danger onClick={() => remove(node)}>
                      删除
                    </Button>
                  )}
                </Space>
              ))}
              {editable && onRepairConnections && (
                <Button size="small" onClick={onRepairConnections}>
                  修复旧连线
                </Button>
              )}
            </Space>
          }
        />
      )}
    </div>
  );
}
