package com.mayday.operations.service;

import com.mayday.common.BusinessException;
import com.mayday.common.ModuleSwitches;
import com.mayday.operations.MessagePublisher;
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
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

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

  public JobRunner(
      ScheduledJobRepository jobs,
      JobExecutionRepository executions,
      MessagePublisher messages,
      ModuleSwitches modules,
      PlatformTransactionManager transactionManager,
      List<JobHandler> registeredHandlers,
      AccessPolicy access,
      UserRepository users) {
    this.jobs = jobs;
    this.executions = executions;
    this.messages = messages;
    this.modules = modules;
    this.transactionManager = transactionManager;
    this.access = access;
    this.users = users;
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
      LocalDateTime next = CronExpression.parse(cron).next(LocalDateTime.now());
      if (next == null) throw new IllegalArgumentException();
      return next;
    } catch (IllegalArgumentException exception) {
      throw new BusinessException("请输入有效的六段 Cron 表达式，例如 0 */5 * * * *");
    }
  }

  /** 内置维护任务最多使用30秒独立数据库事务；调用方回滚不抹去已提交执行记录，长任务须提交业务队列。 */
  public JobExecution run(Long id, boolean manual) {
    if (!modules.isEnabled("scheduler")) throw new BusinessException("调度模块未启用");
    long started = System.nanoTime();
    LocalDateTime[] claimedDue = new LocalDateTime[1];
    String[] claimedName = new String[1];
    TransactionTemplate transaction = isolatedTransaction();
    transaction.setTimeout(30);
    try {
      return transaction.execute(
          status -> {
            var job = jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在"));
            if (!manual
                && (!job.isEnabled()
                    || job.getNextRunAt() == null
                    || job.getNextRunAt().isAfter(LocalDateTime.now()))) return null;
            claimedDue[0] = job.getNextRunAt();
            claimedName[0] = job.getName();
            JobHandler handler = handlers.get(job.getHandler());
            if (handler == null) throw new BusinessException("处理器已移除，请重新配置任务");
            String result = handler.execute();
            job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null);
            return executions.save(execution(id, job.getName(), "SUCCESS", result, started));
          });
    } catch (RuntimeException failure) {
      if (claimedName[0] == null) throw failure;
      // 不把第三方异常消息写入前端：异常可能包含凭据、URL参数或SQL，诊断只保留服务器日志。
      org.slf4j.LoggerFactory.getLogger(JobRunner.class)
          .error("注册处理器执行失败，任务ID={}，异常类型={}", id, failure.getClass().getSimpleName());
      TransactionTemplate failureTransaction = isolatedTransaction();
      JobExecution failed =
          failureTransaction.execute(
              status -> {
                var job = jobs.lock(id).orElse(null);
                if (job != null && Objects.equals(job.getNextRunAt(), claimedDue[0]))
                  job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null);
                JobExecution execution =
                    executions.saveAndFlush(
                        execution(
                            id, claimedName[0], "FAILED", "执行失败；本次业务事务已回滚，请查看服务器诊断记录", started));
                return execution;
              });
      if (failed != null) notifyFailure(failed);
      return failed;
    }
  }

  /** 每批最近一天最早100条未完成提醒，已投递项退出队列，稳定事件键及行锁防重复并避免旧记录饥饿。 */
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 30000, initialDelay = 30000)
  public void retryFailureNotifications() {
    if (!modules.isEnabled("scheduler") || !modules.isEnabled("notifications")) return;
    for (JobExecution failed :
        executions.findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
            "FAILED", LocalDateTime.now().minusDays(1))) notifyFailure(failed);
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
                  pending.setFailureNotifiedAt(LocalDateTime.now());
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
                pending.setFailureNotifiedAt(LocalDateTime.now());
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

  private static JobExecution execution(
      Long jobId, String jobName, String status, String result, long started) {
    JobExecution execution = new JobExecution();
    execution.setJobId(jobId);
    execution.setJobName(jobName);
    execution.setStatus(status);
    execution.setResult(
        result == null ? "已完成" : result.substring(0, Math.min(1000, result.length())));
    execution.setDurationMs((System.nanoTime() - started) / 1_000_000L);
    return execution;
  }
}
