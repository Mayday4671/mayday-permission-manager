package com.mayday.operations.service;

import com.mayday.common.BusinessTime;
import com.mayday.operations.repository.ScheduledJobRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** 每十秒扫描到期任务，执行状态保存于数据库；应用停机期间的错过执行合并为恢复后一次。 */
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class JobSchedule {
  private final ScheduledJobRepository jobs;
  private final JobRunner runner;
  private final com.mayday.common.ModuleSwitches modules;
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(JobSchedule.class);

  /** 扫描当前到期配置，执行器在行锁内重新校验时间和开关；单配置失败记录后继续其他配置，不在扫描方法开启长事务。 */
  @Scheduled(fixedDelay = 10000)
  public void tick() {
    if (!modules.isEnabled("scheduler")) return;
    runner.recover();
    for (var job : jobs.findByEnabledTrueAndNextRunAtLessThanEqual(BusinessTime.now())) {
      try {
        runner.run(job.getId(), false);
      } catch (Exception e) {
        LOG.error("任务 {} 执行失败", job.getId(), e);
      }
    }
  }
}
