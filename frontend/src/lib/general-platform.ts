import { contractClient, unwrapContract } from "./contract-client";
import type { components } from "../types/generated/api";
import { ApiError } from "./api";
import type { PageResult } from "../types";

export type FeedbackRecord = components["schemas"]["FeedbackAdminView"];
export type FeedbackSubmission = components["schemas"]["FeedbackSubmit"];
export type FeedbackProcessing = components["schemas"]["FeedbackProcess"];
export type TrackedFeedback = components["schemas"]["FeedbackPublicView"];
export type MonitorSnapshot = components["schemas"]["MonitorSnapshot"];
export type MonitorPolicy = components["schemas"]["MonitorPolicyView"];
export type ChangeRecord = components["schemas"]["ChangeAuditView"];
export type ScheduledJob = components["schemas"]["ScheduledJob"];
export type JobExecution = components["schemas"]["JobExecution"];

/** 匿名提交只传契约白名单，查询码由服务端生成；不在浏览器构造内部状态或处理人。 */
export async function submitFeedback(body: FeedbackSubmission) {
  return unwrapContract(
    await contractClient.POST("/api/public/feedback", { body }),
  );
}

/** 查询码使用 POST 正文，避免留在网址和历史记录；公开结果类型不包含内部备注。 */
export async function trackFeedback(receipt: string) {
  return unwrapContract(
    await contractClient.POST("/api/public/feedback/track", {
      body: { receipt },
    }),
  );
}

/** 打开处理弹窗重新读取详情，避免把列表缓存当作仍然有效的版本和授权。 */
export async function feedbackDetail(id: number) {
  return unwrapContract(
    await contractClient.GET("/api/operations/feedback/{id}", {
      params: { path: { id } },
    }),
  );
}

/** 分配候选由服务端筛选，展示只使用允许公开的账号编号和名称。 */
export async function feedbackAssignees() {
  return unwrapContract(
    await contractClient.GET("/api/operations/feedback/assignees"),
  );
}

/** 提交版本及公开/私密字段，处理和分配权限分别由服务端复验，失败保留页面输入。 */
export async function processFeedback(id: number, body: FeedbackProcessing) {
  return unwrapContract(
    await contractClient.POST("/api/operations/feedback/{id}/process", {
      params: { path: { id } },
      body,
    }),
  );
}

/** 进程实时指标直接来自服务端，CPU 不可用值保留给页面明确展示。 */
export async function monitorSnapshot() {
  return unwrapContract(await contractClient.GET("/api/operations/monitor"));
}

/** 有限窗口历史由后端按当前节点筛选，页面不自行拼接其他节点或伪造缺失采样。 */
export async function monitorHistory(minutes: number) {
  return unwrapContract(
    await contractClient.GET("/api/operations/monitor/history", {
      params: { query: { minutes } },
    }),
  );
}

/** 读取告警策略携带版本，用于防止两个设置弹窗相互覆盖。 */
export async function monitorPolicy() {
  return unwrapContract(
    await contractClient.GET("/api/operations/monitor/policy"),
  );
}

/** 接收人选项需要监控配置权限，不能作为绕过通讯录权限的全站查询。 */
export async function monitorRecipients() {
  return unwrapContract(
    await contractClient.GET("/api/operations/monitor/recipients"),
  );
}

/** 编辑告警使用生成请求类型，阈值、有效接收人及版本在服务端重新验证。 */
export async function saveMonitorPolicy(
  body: components["schemas"]["MonitorPolicyEdit"],
) {
  return unwrapContract(
    await contractClient.PUT("/api/operations/monitor/policy", { body }),
  );
}

/** 审计详情只读取服务端脱敏投影，不能通过原始请求或对象快照展示密码与正文。 */
export async function changeDetail(id: number) {
  return unwrapContract(
    await contractClient.GET("/api/system/changes/{id}", {
      params: { path: { id } },
    }),
  );
}

/** 处理器候选来自服务端真实注册项，不在页面提供可执行代码或 Java 类名输入。 */
export async function schedulerHandlers() {
  return unwrapContract(
    await contractClient.GET("/api/operations/scheduler/handlers"),
  );
}

/** 提醒接收人经服务端筛选，选择候选不会授予其新的系统权限。 */
export async function schedulerRecipients() {
  return unwrapContract(
    await contractClient.GET("/api/operations/scheduler/recipients"),
  );
}

/** 明确读取选定任务的一页历史，缺失分页字段时报告响应错误，不把异常结果显示成空表。 */
export async function jobExecutions(
  jobId: number,
  page: number,
): Promise<PageResult<JobExecution>> {
  const data = unwrapContract(
    await contractClient.GET("/api/operations/job-logs", {
      params: { query: { jobId, page, size: 5 } },
    }),
  );
  if (
    !data.items ||
    typeof data.total !== "number" ||
    typeof data.page !== "number" ||
    typeof data.size !== "number"
  ) {
    throw new ApiError("执行记录响应不完整，请重试", 502);
  }
  return {
    items: data.items,
    total: data.total,
    page: data.page,
    size: data.size,
  };
}

/** 手动执行和查看独立授权，响应按实际执行状态展示，HTTP 成功不等于处理器成功。 */
export async function runScheduledJob(id: number) {
  return unwrapContract(
    await contractClient.POST("/api/operations/scheduler/{id}/run", {
      params: { path: { id } },
    }),
  );
}
