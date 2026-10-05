import { DataTable } from "./DataTable";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DetailsModal } from "./DetailsModal";
import { FormModal } from "./FormModal";
import {
  WorkflowFields,
  WorkflowValues,
  hydrateWorkflowValues,
  encodeWorkflowValues,
} from "./WorkflowFields";
import { RichTextView } from "./RichTextView";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { AttachmentList } from "./AttachmentList";
import { UserSelect } from "./LookupSelect";
import { QueryState, formatTime } from "./shared";
import { useAuth } from "../lib/auth";
import { api, jsonBody } from "../lib/api";
import { PERSONAL_WORK_POLL_MS } from "../lib/personal-work";
import {
  actionNames,
  approvalStates,
  type ApprovalDetail,
  type WorkflowAction,
} from "../types/workflow";
import { ApprovalEditModal } from "./ApprovalEditModal";
import { WorkflowDiagram } from "./workflow/WorkflowDiagram";
import { WorkflowHandoverModal } from "./WorkflowHandoverModal";
import { WorkflowSubprocessRepairModal } from "./WorkflowSubprocessRepairModal";
interface EventState {
  id: number;
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
}
/** 详情统一按申请参与权读取；操作弹窗使用服务器返回的动作和字段，不信任设计器缓存。 */
export function ApprovalDetailModal({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const { can, session } = useAuth(),
    { message } = App.useApp(),
    client = useQueryClient();
  const [action, setAction] = useState<WorkflowAction | null>(null);
  const [actionSnapshot, setActionSnapshot] = useState<ApprovalDetail | null>(
    null,
  );
  const [editing, setEditing] = useState<ApprovalDetail | null>(null);
  const [handover, setHandover] = useState<ApprovalDetail | null>(null);
  const [recovering, setRecovering] = useState<ApprovalDetail | null>(null);
  const [repairing, setRepairing] = useState<ApprovalDetail | null>(null);
  // 打开确认时固定申请和版本，轮询或切换父子详情不能替用户确认另一批待办。
  const [reminderSnapshot, setReminderSnapshot] = useState<{
    id: number;
    version: number;
    generation: number;
  } | null>(null);
  const [linkedRequest, setLinkedRequest] = useState<{
    sourceId: number | null;
    value: number;
  } | null>(null);
  const [taskChoice, setTaskChoice] = useState<{
    requestId: number;
    taskId: number;
    revision: number;
  } | null>(null);
  // 父子关系在同一个详情弹窗内导航，避免反复打开父/子产生递归弹窗堆栈与重复轮询。
  const recordId =
    id !== null && linkedRequest?.sourceId === id ? linkedRequest.value : id;
  const selectedTaskId =
    taskChoice?.requestId === recordId ? taskChoice.taskId : null;
  // 每次切换办理上下文使用新一代查询，A→B→A 也不能被第一次 A 的迟到响应覆盖。
  const context = useRef({ fingerprint: "", generation: 0 });
  const fingerprint = JSON.stringify([
    id,
    recordId,
    selectedTaskId,
    taskChoice?.revision,
  ]);
  if (context.current.fingerprint !== fingerprint) {
    context.current = {
      fingerprint,
      generation: context.current.generation + 1,
    };
  }
  const [recoveryForm] = Form.useForm<{ reason: string }>();
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: [
      "approvals",
      "detail",
      recordId,
      selectedTaskId,
      context.current.generation,
    ],
    queryFn: ({ signal }) =>
      api<ApprovalDetail>(
        `/operations/requests/${recordId}${selectedTaskId === null ? "" : `?taskId=${selectedTaskId}`}`,
        { signal },
      ),
    enabled: id !== null,
    refetchInterval: id !== null ? PERSONAL_WORK_POLL_MS : false,
  });
  const eventQuery = useQuery({
    queryKey: ["approvals", "events", recordId],
    queryFn: () => api<EventState[]>(`/operations/requests/${recordId}/events`),
    enabled: id !== null && can("requests:manage"),
    refetchInterval: id !== null ? 10000 : false,
  });
  const d = query.data;
  const choiceCache = useRef<{
    id: number | null;
    items: NonNullable<ApprovalDetail["myTasks"]>;
  }>({ id: null, items: [] });
  if (d) choiceCache.current = { id: recordId, items: d.myTasks ?? [] };
  const myTaskChoices =
    choiceCache.current.id === recordId ? choiceCache.current.items : [];
  const writable =
    d?.fields.filter((field) => d.writable.includes(field.id)) ?? [];
  const actionWritable =
    actionSnapshot?.fields.filter((field) =>
      actionSnapshot.writable.includes(field.id),
    ) ?? [];
  const start = (next: WorkflowAction) => {
    form.resetFields();
    if (d)
      form.setFieldsValue({
        values: hydrateWorkflowValues(writable, d.values, d.files),
      });
    setAction(next);
    // 弹窗打开后后台轮询可以刷新详情，但不能替用户将确认版本/待办编号换成较新的申请。
    setActionSnapshot(d ? structuredClone(d) : null);
  };
  const clearOperations = () => {
    setAction(null);
    setActionSnapshot(null);
    setEditing(null);
    setHandover(null);
    setRecovering(null);
    setRepairing(null);
    setReminderSnapshot(null);
    form.resetFields();
    recoveryForm.resetFields();
  };
  useEffect(() => {
    clearOperations();
  }, [fingerprint]);
  const selectTask = (taskId: number) => {
    if (recordId === null) return;
    clearOperations();
    setTaskChoice((previous) => ({
      requestId: recordId,
      taskId,
      revision: (previous?.revision ?? 0) + 1,
    }));
  };
  const showRequest = (next: number | null) => {
    clearOperations();
    setTaskChoice(null);
    setLinkedRequest(next === null ? null : { sourceId: id, value: next });
  };
  const closeDetails = () => {
    clearOperations();
    setTaskChoice(null);
    setLinkedRequest(null);
    onClose();
  };
  return (
    <>
      <DetailsModal
        title="审批详情"
        open={id !== null}
        onClose={closeDetails}
        width={980}
      >
        {myTaskChoices.length > 1 && (
          <div className="form-message">
            <label htmlFor="approval-personal-task">办理节点</label>
            <Select
              id="approval-personal-task"
              aria-label="办理节点"
              style={{ width: "100%", marginTop: 8 }}
              value={selectedTaskId ?? d?.myTaskId ?? undefined}
              options={myTaskChoices.map((task) => ({
                value: task.id,
                label: task.nodeName,
              }))}
              onChange={selectTask}
            />
          </div>
        )}
        {query.isError && selectedTaskId !== null && (
          <Button
            onClick={() => {
              clearOperations();
              setTaskChoice(null);
            }}
          >
            重新加载当前待办
          </Button>
        )}
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {d && (
            <>
              <div className="approval-heading">
                <div>
                  <h3>{d.title}</h3>
                  <span>
                    {d.definitionName} · 版本 {d.definitionVersionNumber ?? 1}
                  </span>
                </div>
                <Tag
                  color={
                    d.status === "APPROVED"
                      ? "green"
                      : d.status === "PENDING"
                        ? "blue"
                        : d.status === "REJECTED"
                          ? "red"
                          : "default"
                  }
                >
                  {d.status === "CANCELLED"
                    ? "已终止"
                    : approvalStates[d.status]}
                </Tag>
              </div>
              <Descriptions
                size="small"
                column={2}
                items={[
                  { key: "who", label: "申请人", children: d.applicantName },
                  {
                    key: "at",
                    label: "提交时间",
                    children: formatTime(d.submittedAt),
                  },
                  {
                    key: "node",
                    label: "当前节点",
                    children:
                      d.currentNodeName ??
                      (d.canEdit ? "申请人填写" : "流程已结束"),
                  },
                  {
                    key: "end",
                    label: "结束时间",
                    children: formatTime(d.completedAt),
                  },
                ]}
              />
              {d.hasPrivateDraft && (
                <Alert
                  type="info"
                  className="form-message"
                  title={
                    d.canEdit
                      ? "当前显示你保存的未提交修改，仅你可见。其他参与者查看上一提交轮，重新提交后才进入审批。"
                      : "当前显示你保留的未提交修改，仅你可见；这些修改没有进入本次审批结果。"
                  }
                />
              )}
              {recordId !== id && (
                <Button size="small" onClick={() => showRequest(null)}>
                  查看原申请
                </Button>
              )}
              {d.canViewParent && d.parentRequestId && (
                <Button
                  size="small"
                  onClick={() => showRequest(d.parentRequestId!)}
                >
                  查看父申请
                </Button>
              )}
              <Tabs
                items={[
                  {
                    key: "form",
                    label: "申请信息",
                    children: (
                      <WorkflowValues
                        fields={d.fields}
                        values={d.values}
                        labels={d.valueLabels}
                        files={d.files}
                        requestId={d.id}
                      />
                    ),
                  },
                  {
                    key: "diagram",
                    label: `运行流程 · 第${d.runNumber}轮`,
                    children: (
                      <WorkflowDiagram
                        startNodeId={d.diagram.startNodeId}
                        items={d.diagram.nodes}
                      />
                    ),
                  },
                  ...(d.execution?.length || d.childRequests?.length
                    ? [
                        {
                          key: "execution",
                          label: "执行状态",
                          children: (
                            <Space
                              orientation="vertical"
                              style={{ width: "100%" }}
                              size="middle"
                            >
                              <DataTable
                                rowKey="tokenId"
                                size="small"
                                dataSource={d.execution}
                                pagination={{ pageSize: 6 }}
                                columns={[
                                  {
                                    title: "节点",
                                    dataIndex: "nodeId",
                                    render: (value: string) =>
                                      d.diagram.nodes.find(
                                        (item) => item.id === value,
                                      )?.name ?? value,
                                  },
                                  {
                                    title: "执行状态",
                                    dataIndex: "status",
                                    render: (value: string) =>
                                      ({
                                        ACTIVE: "推进中",
                                        APPROVAL: "待办理",
                                        WAIT_JOIN: "等待全部支路完成",
                                        WAIT_CHILD: "等待子流程",
                                        FAILED: "等待恢复",
                                        DONE: "已完成",
                                      })[value] ?? value,
                                  },
                                  ...(can("requests:manage")
                                    ? [
                                        {
                                          title: "恢复说明",
                                          dataIndex: "error",
                                          render: (value: string | null) =>
                                            value ?? "—",
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                              {!!d.childRequests?.length && (
                                <DataTable
                                  rowKey="id"
                                  size="small"
                                  dataSource={d.childRequests}
                                  pagination={{ pageSize: 5 }}
                                  columns={[
                                    { title: "子流程", dataIndex: "name" },
                                    {
                                      title: "固定版本",
                                      dataIndex: "versionId",
                                      render: (value: number) => `#${value}`,
                                    },
                                    {
                                      title: "状态",
                                      dataIndex: "status",
                                      render: (value: string) =>
                                        approvalStates[value] ?? value,
                                    },
                                    {
                                      title: "操作",
                                      render: (_, row) =>
                                        row.canView ? (
                                          <Button
                                            type="link"
                                            onClick={() => showRequest(row.id)}
                                          >
                                            查看申请
                                          </Button>
                                        ) : (
                                          "无查看权限"
                                        ),
                                    },
                                  ]}
                                />
                              )}
                            </Space>
                          ),
                        },
                      ]
                    : []),
                  ...(d.business
                    ? [
                        {
                          key: "business",
                          label: "送审内容",
                          children: (
                            <>
                              {(!d.business.currentRevision ||
                                d.business.deleted) && (
                                <Alert
                                  className="form-message"
                                  type="warning"
                                  title={
                                    d.business.deleted
                                      ? "关联文章已在回收站"
                                      : "文章已有新修订，本次审核仅对下面的送审版本有效"
                                  }
                                />
                              )}
                              <h3>
                                {d.business.title} · 修订{" "}
                                {d.business.revisionNumber}
                              </h3>
                              <p>
                                {d.business.category} ·{" "}
                                {d.business.tags.join("、")}
                              </p>
                              {d.business.coverId && (
                                <AuthenticatedImage
                                  endpoint={`/operations/requests/${d.id}/content-files/${d.business.coverId}?image=true`}
                                  alt="送审封面"
                                />
                              )}
                              <RichTextView content={d.business.content} />
                              <AttachmentList
                                files={d.business.attachments}
                                endpoint={(file) =>
                                  `/operations/requests/${d.id}/content-files/${file.id}`
                                }
                              />
                            </>
                          ),
                        },
                      ]
                    : []),
                  {
                    key: "tasks",
                    label: "节点待办",
                    children: (
                      <DataTable
                        rowKey="id"
                        size="small"
                        dataSource={d.tasks}
                        pagination={{ pageSize: 6 }}
                        columns={[
                          { title: "轮次", dataIndex: "runNumber", width: 70 },
                          { title: "节点", dataIndex: "nodeName" },
                          {
                            title: "审批人",
                            dataIndex: "assigneeName",
                            render: (value, row) => (
                              <span title={row.assignmentNote ?? undefined}>
                                {value}
                                {row.originalAssigneeName && (
                                  <small style={{ display: "block" }}>
                                    原指定：{row.originalAssigneeName}
                                  </small>
                                )}
                              </span>
                            ),
                          },
                          {
                            title: "状态",
                            dataIndex: "status",
                            render: (value, row) =>
                              row.kind === "COPY"
                                ? row.readAt
                                  ? "抄送已读"
                                  : "抄送未读"
                                : (approvalStates[value] ?? value),
                          },
                          {
                            title: "加签",
                            dataIndex: "mandatory",
                            render: (v) => (v ? "必签" : "—"),
                          },
                          {
                            title: "处理期限",
                            dataIndex: "dueAt",
                            render: (value, row) =>
                              value ? (
                                row.status === "PENDING" &&
                                new Date(value).getTime() < Date.now() ? (
                                  <Tag color="error">{formatTime(value)}</Tag>
                                ) : (
                                  formatTime(value)
                                )
                              ) : (
                                "—"
                              ),
                          },
                          {
                            title: "处理时间",
                            dataIndex: "decidedAt",
                            render: formatTime,
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    key: "history",
                    label: "处理历史",
                    children: (
                      <DataTable
                        rowKey="id"
                        size="small"
                        dataSource={d.history}
                        pagination={{ pageSize: 8 }}
                        expandable={{
                          rowExpandable: (row) =>
                            Object.keys(row.submittedValues ?? {}).length > 0,
                          expandedRowRender: (row) => (
                            <WorkflowValues
                              fields={row.fields ?? d.fields}
                              values={row.submittedValues ?? {}}
                              labels={d.valueLabels}
                              files={row.files ?? d.files}
                              requestId={d.id}
                            />
                          ),
                        }}
                        columns={[
                          { title: "轮次", dataIndex: "runNumber", width: 65 },
                          {
                            title: "处理人",
                            dataIndex: "actorName",
                            width: 100,
                          },
                          {
                            title: "动作",
                            dataIndex: "action",
                            width: 80,
                            render: (value) => actionNames[value] ?? value,
                          },
                          { title: "节点", dataIndex: "nodeName", width: 130 },
                          {
                            title: "意见",
                            dataIndex: "comment",
                            render: (value, row) => (
                              <span className="preserve-lines">
                                {row.targetUserName && (
                                  <span>
                                    接收人：{row.targetUserName}
                                    <br />
                                  </span>
                                )}
                                {value || "—"}
                                {row.subprocessRepair && (
                                  <div>
                                    固定版本 {row.subprocessRepair.versionId} ·{" "}
                                    {row.subprocessRepair.childNodeName}
                                    <br />
                                    {row.subprocessRepair.before
                                      .map((person) => person.label)
                                      .join("、") || "暂无人员"}
                                    {" → "}
                                    {row.subprocessRepair.after
                                      .map((person) => person.label)
                                      .join("、")}
                                  </div>
                                )}
                                {row.targetNodeId && (
                                  <div>
                                    退回至：
                                    {d.diagram.nodes.find(
                                      (node) => node.id === row.targetNodeId,
                                    )?.name ?? row.targetNodeId}
                                  </div>
                                )}
                                {Object.entries(row.changes ?? {}).map(
                                  ([key, change]) => (
                                    <div
                                      className="approval-field-change"
                                      key={key}
                                    >
                                      <b>
                                        {(row.fields ?? d.fields).find(
                                          (f) => f.id === key,
                                        )?.label ?? key}
                                      </b>
                                      <span>
                                        {JSON.stringify(change.before) ??
                                          "空值"}{" "}
                                        →{" "}
                                        {JSON.stringify(change.after) ?? "空值"}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </span>
                            ),
                          },
                          {
                            title: "时间",
                            dataIndex: "createdAt",
                            width: 165,
                            render: formatTime,
                          },
                        ]}
                      />
                    ),
                  },
                  ...(can("requests:manage")
                    ? [
                        {
                          key: "events",
                          label: "通知状态",
                          children: (
                            <QueryState
                              loading={eventQuery.isLoading}
                              error={eventQuery.error}
                              retry={() => void eventQuery.refetch()}
                            >
                              <DataTable
                                rowKey="id"
                                size="small"
                                dataSource={eventQuery.data}
                                pagination={{ pageSize: 8 }}
                                columns={[
                                  {
                                    title: "状态",
                                    dataIndex: "status",
                                    render: (v) =>
                                      ({
                                        PENDING: "等待投递",
                                        DELIVERED: "已投递",
                                        SKIPPED: "接收人已删除",
                                      })[String(v)] ?? v,
                                  },
                                  { title: "重试次数", dataIndex: "attempts" },
                                  {
                                    title: "处理说明",
                                    dataIndex: "lastError",
                                    render: (v) => v ?? "—",
                                  },
                                ]}
                              />
                              {eventQuery.data?.some(
                                (e) => e.status === "PENDING",
                              ) && (
                                <Button
                                  onClick={async () => {
                                    try {
                                      await api(
                                        `/operations/requests/${recordId}/retry-notifications`,
                                        { method: "POST" },
                                      );
                                      message.success("已安排重试");
                                      void eventQuery.refetch();
                                    } catch (e) {
                                      message.error((e as Error).message);
                                    }
                                  }}
                                >
                                  重试未完成投递
                                </Button>
                              )}
                            </QueryState>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {(d.canEdit ||
                d.canTerminate ||
                d.unreadCopies > 0 ||
                d.status === "PENDING") && (
                <Space wrap className="approval-actions">
                  {d.status === "DRAFT" && d.canEdit && (
                    <Popconfirm
                      title="删除此未提交草稿？"
                      onConfirm={async () => {
                        try {
                          await api(
                            `/operations/requests/${d.id}?version=${d.version}`,
                            { method: "DELETE" },
                          );
                          await client.invalidateQueries();
                          onClose();
                          message.success("草稿已删除");
                        } catch (error) {
                          message.error((error as Error).message);
                        }
                      }}
                    >
                      <Button danger>删除草稿</Button>
                    </Popconfirm>
                  )}
                  {d.canEdit && (
                    <Button type="primary" onClick={() => setEditing(d)}>
                      {d.status === "DRAFT" ? "继续填写" : "修改并重新提交"}
                    </Button>
                  )}
                  {d.canHandover && (
                    <Button onClick={() => setHandover(d)}>人员交接</Button>
                  )}
                  {d.canRecover && (
                    <Button
                      onClick={() => {
                        recoveryForm.resetFields();
                        setRecovering(d);
                      }}
                    >
                      恢复执行
                    </Button>
                  )}
                  {d.canRepairSubprocess && (
                    <Button onClick={() => setRepairing(structuredClone(d))}>
                      修复子流程人员
                    </Button>
                  )}
                  {d.canTerminate && (
                    <Button danger onClick={() => start("TERMINATE")}>
                      终止申请
                    </Button>
                  )}
                  {d.unreadCopies > 0 && (
                    <Button
                      onClick={async () => {
                        try {
                          await api(
                            `/operations/requests/${d.id}/copies/read`,
                            { method: "POST" },
                          );
                          void client.invalidateQueries({
                            queryKey: ["approvals"],
                          });
                        } catch (error) {
                          message.error((error as Error).message);
                        }
                      }}
                    >
                      标记抄送已读
                    </Button>
                  )}
                  {d.status === "PENDING" && (
                    <>
                      {d.actions
                        .filter((a) => a !== "COMMENT")
                        .map((a) => (
                          <Button
                            key={a}
                            type={a === "APPROVE" ? "primary" : "default"}
                            danger={a === "REJECT"}
                            onClick={() => start(a)}
                          >
                            {actionNames[a]}
                          </Button>
                        ))}
                      {d.canComment && (
                        <Button onClick={() => start("COMMENT")}>评论</Button>
                      )}
                      {d.canWithdraw && (
                        <Button onClick={() => start("WITHDRAW")}>
                          撤回申请
                        </Button>
                      )}
                      {can("requests:remind") &&
                        (d.applicantId === session?.user.id ||
                          can("requests:manage")) && (
                          <Popconfirm
                            title="提醒所有当前审批人？"
                            description="每项申请 30 分钟内只能催办一次。"
                            disabled={!d.canRemind}
                            open={reminderSnapshot?.id === d.id}
                            onOpenChange={(open) =>
                              setReminderSnapshot(
                                open
                                  ? {
                                      id: d.id,
                                      version: d.version,
                                      generation: context.current.generation,
                                    }
                                  : null,
                              )
                            }
                            onConfirm={async () => {
                              const snapshot = reminderSnapshot;
                              if (
                                !snapshot ||
                                snapshot.generation !==
                                  context.current.generation
                              )
                                return;
                              try {
                                await api(
                                  `/operations/requests/${snapshot.id}/remind`,
                                  {
                                    method: "POST",
                                    body: jsonBody({
                                      version: snapshot.version,
                                    }),
                                  },
                                );
                                void client.invalidateQueries({
                                  queryKey: ["approvals"],
                                });
                                void client.invalidateQueries({
                                  queryKey: ["requests"],
                                });
                                message.success("已安排催办通知");
                              } catch (error) {
                                message.error((error as Error).message);
                              } finally {
                                setReminderSnapshot((current) =>
                                  current === snapshot ? null : current,
                                );
                              }
                            }}
                          >
                            <Button
                              disabled={!d.canRemind}
                              title={
                                !d.canRemind
                                  ? (d.remindUnavailableReason ??
                                    "当前不可催办")
                                  : undefined
                              }
                            >
                              催办
                            </Button>
                          </Popconfirm>
                        )}
                    </>
                  )}
                </Space>
              )}
            </>
          )}
        </QueryState>
      </DetailsModal>
      <WorkflowHandoverModal
        record={handover}
        onClose={() => setHandover(null)}
        onSuccess={async () => {
          await query.refetch();
          await client.invalidateQueries({
            queryKey: ["resource", "requests"],
          });
        }}
      />
      <WorkflowSubprocessRepairModal
        record={repairing}
        onClose={() => setRepairing(null)}
        onSuccess={async () => {
          await query.refetch();
          await client.invalidateQueries({
            queryKey: ["resource", "requests"],
          });
        }}
      />
      <FormModal
        zIndex={1100}
        title={action ? actionNames[action] + "审批" : ""}
        open={action !== null}
        form={form}
        onCancel={() => setAction(null)}
        width={700}
        okText={action ? actionNames[action] : "确定"}
        onSubmit={async (values) => {
          if (!actionSnapshot || !action) return;
          await api(`/operations/requests/${actionSnapshot.id}/decision`, {
            method: "POST",
            body: jsonBody({
              version: actionSnapshot.version,
              taskId: actionSnapshot.myTaskId,
              action,
              comment: values.comment,
              targetUserId: values.targetUserId,
              targetNodeId:
                values.targetNodeId === "applicant"
                  ? undefined
                  : values.targetNodeId,
              values: ["APPROVE", "REJECT"].includes(action)
                ? encodeWorkflowValues(actionWritable, values.values ?? {})
                : undefined,
            }),
          });
          setAction(null);
          setActionSnapshot(null);
          // 已办理的选定待办不能继续用于详情查询；重新取服务器当前任务，保留其他并行支路。
          setTaskChoice(null);
          void client.invalidateQueries();
          message.success("操作已完成");
        }}
      >
        {action && (
          <>
            {action === "RETURN" && (
              <Form.Item
                name="targetNodeId"
                label="退回位置"
                initialValue="applicant"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    {
                      value: "applicant",
                      label: "申请人 · 修改后从起点重新提交",
                    },
                    ...(actionSnapshot?.returnTargets.map((target) => ({
                      value: target.id,
                      label: `${target.name} · 重新办理后继续流程`,
                    })) ?? []),
                  ]}
                />
              </Form.Item>
            )}
            {action === "REJECT" && (
              <Alert
                type="warning"
                title="驳回会结束本次申请，不能继续编辑重提。需要修改补充时请选择退回。"
                className="form-message"
              />
            )}
            {["TRANSFER", "ADD_SIGN"].includes(action) && (
              <Form.Item
                name="targetUserId"
                label="接收人"
                rules={[{ required: true }]}
              >
                <UserSelect />
              </Form.Item>
            )}
            {["APPROVE", "REJECT"].includes(action) &&
              actionWritable.length > 0 && (
                <WorkflowFields fields={actionWritable} />
              )}
            <Form.Item
              name="comment"
              label={action === "COMMENT" ? "评论" : "处理意见"}
              rules={[
                {
                  required: [
                    "REJECT",
                    "RETURN",
                    "TERMINATE",
                    "COMMENT",
                  ].includes(action),
                  whitespace: true,
                },
              ]}
            >
              <Input.TextArea rows={4} maxLength={500} showCount />
            </Form.Item>
          </>
        )}
      </FormModal>
      <ApprovalEditModal record={editing} onClose={() => setEditing(null)} />
      <FormModal
        title="恢复流程执行"
        open={recovering !== null}
        form={recoveryForm}
        width={520}
        onCancel={() => setRecovering(null)}
        onSubmit={async (values) => {
          if (!recovering) return;
          await api(`/operations/requests/${recovering.id}/recover`, {
            method: "POST",
            body: jsonBody({
              version: recovering.version,
              reason: values.reason,
            }),
          });
          setRecovering(null);
          await client.invalidateQueries();
          message.success("已按原固定节点重新检查并恢复");
        }}
      >
        <Alert
          className="form-message"
          type="info"
          title="先完成账号交接、权限恢复或子流程启用。恢复会重新核验原固定版本，依赖仍无效时继续保留失败状态。"
        />
        <Form.Item
          name="reason"
          label="恢复说明"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
      </FormModal>
    </>
  );
}
