package com.mayday.operations.service;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.system.repository.*;
import java.time.*;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 任务执行事务持有行锁，多实例轮询不会重复领取同一次计划执行。处理器均为固定的内部操作。 */
@Service
@RequiredArgsConstructor
public class JobRunner {
  public static final Set<String> HANDLERS = Set.of("SESSION_CLEANUP", "DATABASE_CHECK");
  private final ScheduledJobRepository jobs;
  private final JobExecutionRepository executions;
  private final SessionRepository sessions;
  private final UserRepository users;

  public static LocalDateTime next(String cron) {
    try {
      var next = CronExpression.parse(cron).next(LocalDateTime.now());
      if (next == null) throw new IllegalArgumentException();
      return next;
    } catch (IllegalArgumentException e) {
      throw new BusinessException("请输入有效的六段 Cron 表达式，例如 0 */5 * * * *");
    }
  }

  @Transactional
  public JobExecution run(Long id, boolean manual) {
    var job = jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在"));
    if (!manual
        && (!job.isEnabled()
            || job.getNextRunAt() == null
            || job.getNextRunAt().isAfter(LocalDateTime.now()))) return null;
    var execution = new JobExecution();
    execution.setJobId(id);
    execution.setJobName(job.getName());
    long start = System.nanoTime();
    if (!HANDLERS.contains(job.getHandler())) throw new BusinessException("未知任务处理器");
    if (job.getHandler().equals("SESSION_CLEANUP")) {
      sessions.deleteByExpiresAtBefore(Instant.now());
      execution.setResult("已清理过期会话");
    } else {
      // 数据库检查可以执行查询，但调度权限不等于 users:view 或全部用户范围。
      // 只报告检查是否成功，不能通过任务执行结果/历史日志暴露全站用户总数。
      users.count();
      execution.setResult("数据库连接正常");
    }
    execution.setStatus("SUCCESS");
    execution.setDurationMs((System.nanoTime() - start) / 1000000);
    job.setNextRunAt(job.isEnabled() ? next(job.getCron()) : null);
    return executions.save(execution);
  }
}
