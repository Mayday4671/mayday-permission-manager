package com.mayday.operations.service;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.ModuleSwitches;
import com.mayday.operations.MessagePublisher;
import com.mayday.operations.cluster.DurableTasks;
import com.mayday.operations.model.JobExecution;
import com.mayday.operations.repository.JobExecutionRepository;
import com.mayday.operations.repository.ScheduledJobRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * 短维护任务持有配置行锁并重查到期时间，正常完成时多实例扫描不会重复领取同一期计划。 失败先回滚业务事务，再独立保存失败记录和推进计划；通知故障不能回滚结果。
 * 回滚与失败保存之间仍可能被另一个节点领取，处理器必须使用业务幂等键，外部副作用不能靠数据库回滚撤销。
 */
@Service
public class JobRunner {
  private final ScheduledJobRepository jobs;
  private final JobExecutionRepository executions;
  private final MessagePublisher messages;
  private final ModuleSwitches modules;
  private final PlatformTransactionManager transactionManager;
  private final Map<String, JobHandler> handlers;
  private final AccessPolicy access;
  private final UserRepository users;
  private final DurableTasks durable;
  private final JsonMapper json;
  private final Map<Long, DurableTasks.Lease> active = new ConcurrentHashMap<>();
  private static final String TASK_TYPE = "SCHEDULER";

  public JobRunner(
      ScheduledJobRepository jobs,
      JobExecutionRepository executions,
      MessagePublisher messages,
      ModuleSwitches modules,
      PlatformTransactionManager transactionManager,
      List<JobHandler> registeredHandlers,
      AccessPolicy access,
      UserRepository users,
      DurableTasks durable,
      JsonMapper json) {
    this.jobs = jobs;
    this.executions = executions;
    this.messages = messages;
    this.modules = modules;
    this.transactionManager = transactionManager;
    this.access = access;
    this.users = users;
    this.durable = durable;
    this.json = json;
    Map<String, JobHandler> registry = new LinkedHashMap<>();
    for (JobHandler handler : registeredHandlers) {
      if (!handler.key().matches("[A-Z][A-Z0-9_]{0,63}")
          || registry.putIfAbsent(handler.key(), handler) != null)
        throw new IllegalStateException("任务处理器名称无效或重复");
    }
    handlers = Map.copyOf(registry);
  }

  /** 页面候选来自实际注册 Bean，不维护第二份固定处理器列表。 */
  public Map<String, String> handlerOptions() {
    Map<String, String> options = new java.util.TreeMap<>();
    handlers.forEach((key, handler) -> options.put(key, handler.label()));
    return options;
  }

  /** 验证六段Cron并取得下一次时间，不接受脚本、SQL或任意类名作为执行表达式。 */
  public static LocalDateTime next(String cron) {
    try {
      LocalDateTime next = CronExpression.parse(cron).next(BusinessTime.now());
      if (next == null) throw new IllegalArgumentException();
      return next;
    } catch (IllegalArgumentException exception) {
      throw new BusinessException("请输入有效的六段 Cron 表达式，例如 0 */5 * * * *");
    }
  }

  /** 冻结注册处理器及计划时间；配置编辑不能替换已经排队的工作正文。 */
  public record Work(Long jobId, String name, String handler, String expectedDue, boolean manual) {}

  /** 先持久化稳定业务键再领取；进程在任何阶段停止都留下可恢复队列，不在业务回滚后重新发起同一期。 */
  public JobExecution run(Long id, boolean manual) {
    return run(id, manual, null);
  }

  /** 页面网络重试可提交稳定标识；同配置同标识的手动请求不会重复执行外部操作。 */
  public JobExecution run(Long id, boolean manual, String requestKey) {
    if (requestKey != null && !requestKey.matches("[a-zA-Z0-9-]{16,64}"))
      throw new BusinessException("执行提交标识无效");
    if (!modules.isEnabled("scheduler")) throw new BusinessException("调度模块未启用");
    Work work =
        isolatedTransaction()
            .execute(
                status -> {
                  var job = jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在"));
                  if (!manual
                      && (!job.isEnabled()
                          || job.getNextRunAt() == null
                          || job.getNextRunAt().isAfter(BusinessTime.now()))) return null;
                  // 手动稳定键不绑定会随首次成功推进的计划时间，否则启用配置的网络重试会被误判为不同内容。
                  return new Work(
                      id,
                      job.getName(),
                      job.getHandler(),
                      manual || job.getNextRunAt() == null ? "" : job.getNextRunAt().toString(),
                      manual);
                });
    if (work == null) return null;
    String key =
        manual
            ? id + ":manual:" + (requestKey == null ? UUID.randomUUID() : requestKey)
            : id + ":scheduled:" + work.expectedDue();
    durable.enqueue(TASK_TYPE, key, json.writeValueAsString(work), 3);
    var receipt =
        durable.inspect(
            TASK_TYPE,
            key,
            () ->
                executions
                    .findByTaskKey(key)
                    .orElseGet(
                        () -> {
                          var history = new JobExecution();
                          history.setTaskKey(key);
                          history.setJobId(id);
                          history.setJobName(work.name());
                          history.setStatus("QUEUED");
                          history.setResult("等待执行");
                          return executions.saveAndFlush(history);
                        }));
    var lease = durable.claim(TASK_TYPE, key);
    return lease == null ? executions.findByTaskKey(key).orElse(receipt) : execute(lease);
  }

  /** 定时扫描也恢复租约过期的手动任务；恢复沿用原业务键和冻结处理器，不产生第二份历史。 */
  public void recover() {
    if (!modules.isEnabled("scheduler")) return;
    for (var history : executions.findTop100ByStatusInOrderByIdAsc(List.of("RUNNING", "QUEUED"))) {
      if (history.getTaskKey() == null) continue;
      durable.synchronizeTerminal(
          TASK_TYPE,
          history.getTaskKey(),
          terminal -> {
            var current = executions.lock(history.getId()).orElse(null);
            if (current == null || !List.of("RUNNING", "QUEUED").contains(current.getStatus()))
              return;
            current.setStatus(terminal);
            current.setResult("FAILED".equals(terminal) ? "恢复尝试已达上限，可明确重试" : "已取消");
            jobs.lock(current.getJobId())
                .ifPresent(
                    job -> {
                      String dueKey = job.getId() + ":scheduled:" + job.getNextRunAt();
                      if (current.getTaskKey().equals(dueKey))
                        job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null);
                    });
          });
    }
    for (int count = 0; count < 10; count++) {
      var lease = durable.claim(TASK_TYPE);
      if (lease == null) return;
      execute(lease);
    }
  }

  /** 心跳只维护本机实际执行的租约，DB 时钟与随机令牌决定所有权。 */
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 5000)
  public void renew() {
    for (var lease : active.values()) durable.heartbeat(lease);
  }

  private JobExecution execute(DurableTasks.Lease lease) {
    long started = System.nanoTime();
    Work work = json.readValue(lease.payload(), Work.class);
    active.put(lease.id(), lease);
    try {
      durable.fenced(
          lease,
          () -> {
            var history = history(lease, work);
            history.setStatus("RUNNING");
            history.setResult("执行中");
            history.setAttempts(lease.attempt());
            executions.saveAndFlush(history);
            return null;
          });
      return durable.finish(
          lease,
          () -> {
            var job = jobs.lock(work.jobId()).orElseThrow(() -> new BusinessException("任务配置已删除"));
            var handler = handlers.get(work.handler());
            if (handler == null) throw new BusinessException("处理器已移除，请重新配置任务");
            String result = handler.execute(new JobHandler.Context(lease.key(), lease.attempt()));
            var history = history(lease, work);
            history.setStatus("SUCCESS");
            history.setResult(summary(result));
            history.setDurationMs((System.nanoTime() - started) / 1000000);
            history.setAttempts(lease.attempt());
            advance(job, work);
            return executions.saveAndFlush(history);
          });
    } catch (DurableTasks.LostLease stale) {
      return executions.findByTaskKey(lease.key()).orElse(null);
    } catch (RuntimeException failure) {
      org.slf4j.LoggerFactory.getLogger(JobRunner.class)
          .error("注册处理器执行失败，任务ID={}，异常类型={}", work.jobId(), failure.getClass().getSimpleName());
      JobExecution[] failed = new JobExecution[1];
      // 内置维护是短事务；业务校验异常终止，暂态连接/事务错误才自动退避，不重试任意外部副作用。
      boolean retryable = failure instanceof org.springframework.dao.TransientDataAccessException;
      durable.failed(
          lease,
          "执行失败；业务事务已回滚，请查看服务器诊断记录",
          retryable,
          nextState -> {
            var history = history(lease, work);
            history.setStatus("QUEUED".equals(nextState) ? "QUEUED" : "FAILED");
            history.setResult("执行失败；业务事务已回滚，请查看服务器诊断记录");
            history.setDurationMs((System.nanoTime() - started) / 1000000);
            history.setAttempts(lease.attempt());
            if (!"QUEUED".equals(nextState))
              jobs.lock(work.jobId()).ifPresent(job -> advance(job, work));
            failed[0] = executions.saveAndFlush(history);
          });
      if (failed[0] != null && "FAILED".equals(failed[0].getStatus())) notifyFailure(failed[0]);
      return failed[0];
    } finally {
      active.remove(lease.id());
    }
  }

  private JobExecution history(DurableTasks.Lease lease, Work work) {
    return executions
        .findByTaskKey(lease.key())
        .orElseGet(
            () -> {
              var result = new JobExecution();
              result.setTaskKey(lease.key());
              result.setJobId(work.jobId());
              result.setJobName(work.name());
              return result;
            });
  }

  private static String summary(String result) {
    return result == null ? "已完成" : result.substring(0, Math.min(1000, result.length()));
  }

  private void advance(com.mayday.operations.model.ScheduledJob job, Work work) {
    String currentDue = job.getNextRunAt() == null ? "" : job.getNextRunAt().toString();
    if (work.manual() || Objects.equals(currentDue, work.expectedDue()))
      job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null);
  }

  /** 任务编辑、删除检查真实队列历史；不允许页面把已运行处理器改成另一个处理器。 */
  public void requireIdle(Long jobId) {
    if (executions.existsByJobIdAndStatusIn(jobId, List.of("RUNNING", "QUEUED")))
      throw new BusinessException("任务正在执行或等待恢复，请先完成或取消执行");
  }

  /** 取消作废原租约；工作器下一次提交会回滚，不承诺撤销已发生的外部副作用。 */
  public JobExecution cancel(Long executionId) {
    var history =
        executions.findById(executionId).orElseThrow(() -> new BusinessException("执行记录不存在"));
    if (history.getTaskKey() == null
        || !durable.cancel(
            TASK_TYPE,
            history.getTaskKey(),
            () -> {
              var current = executions.lock(executionId).orElseThrow();
              current.setStatus("CANCELLED");
              current.setResult("已取消，未提交的业务结果已作废");
              jobs.lock(current.getJobId())
                  .ifPresent(job -> job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null));
            })) throw new BusinessException("执行状态已变化，请刷新");
    return executions.findById(executionId).orElseThrow();
  }

  /** 明确恢复失败或取消执行，保留同一业务幂等键；注册处理器必须按 Context.operationKey 实现外部幂等。 */
  public JobExecution retry(Long executionId) {
    var history =
        executions.findById(executionId).orElseThrow(() -> new BusinessException("执行记录不存在"));
    if (history.getTaskKey() == null
        || !durable.retry(
            TASK_TYPE,
            history.getTaskKey(),
            () -> {
              var current = executions.lock(executionId).orElseThrow();
              current.setStatus("QUEUED");
              current.setResult("等待恢复");
              current.setFailureNotifiedAt(null);
            })) throw new BusinessException("执行状态已变化，请刷新");
    return executions.findById(executionId).orElseThrow();
  }

  /** 每批最近一天最早100条未完成提醒，已投递项退出队列，稳定事件键及行锁防重复并避免旧记录饥饿。 */
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 30000, initialDelay = 30000)
  public void retryFailureNotifications() {
    if (!modules.isEnabled("scheduler") || !modules.isEnabled("notifications")) return;
    for (JobExecution failed :
        executions.findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
            "FAILED", BusinessTime.now().minusDays(1))) notifyFailure(failed);
  }

  /** 投递与执行结果分开提交，接收人失效或数据库暂不可用只影响提醒，并保留下一轮重试机会。 */
  private void notifyFailure(JobExecution execution) {
    if (!modules.isEnabled("notifications")) return;
    try {
      isolatedTransaction()
          .executeWithoutResult(
              status -> {
                var pending = executions.lock(execution.getId()).orElse(null);
                if (pending == null || pending.getFailureNotifiedAt() != null) return;
                var job = jobs.findById(execution.getJobId()).orElse(null);
                var recipient =
                    job == null || job.getAlertUserId() == null
                        ? null
                        : users.findById(job.getAlertUserId()).orElse(null);
                if (recipient == null || !access.hasFor(recipient, "scheduler:view")) {
                  // 未配置或失效接收人不无限占据待发队列，恢复权限不会补发历史跳过的提醒。
                  pending.setFailureNotifiedAt(BusinessTime.now());
                  return;
                }
                messages.publish(
                    "scheduler:failure:" + execution.getId(),
                    recipient.getId(),
                    "调度执行失败",
                    execution.getJobName() + "执行失败，请查看执行记录。",
                    "任务调度",
                    "SCHEDULER",
                    execution.getJobId());
                pending.setFailureNotifiedAt(BusinessTime.now());
              });
    } catch (RuntimeException failure) {
      org.slf4j.LoggerFactory.getLogger(JobRunner.class)
          .warn("调度失败提醒尚未投递，将重试，执行ID={}", execution.getId());
    }
  }

  // 扩展服务可能带有外层事务，三个阶段均显式挂起它，避免失败历史加入 rollback-only 事务。
  private TransactionTemplate isolatedTransaction() {
    TransactionTemplate transaction = new TransactionTemplate(transactionManager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    transaction.setTimeout(30);
    return transaction;
  }
}
