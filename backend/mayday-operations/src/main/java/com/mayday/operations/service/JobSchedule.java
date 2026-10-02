package com.mayday.operations.service;

import com.mayday.operations.repository.ScheduledJobRepository;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.*;

/** 每十秒扫描到期任务，执行状态保存于数据库；应用停机期间的错过执行合并为恢复后一次。 */
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class JobSchedule {
  private final ScheduledJobRepository jobs;
  private final JobRunner runner;
  private final com.mayday.common.ModuleSwitches modules;
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(JobSchedule.class);

  @Scheduled(fixedDelay = 10000)
  public void tick() {
    if (!modules.isEnabled("scheduler")) return;
    for (var job : jobs.findByEnabledTrueAndNextRunAtLessThanEqual(LocalDateTime.now())) {
      try {
        runner.run(job.getId(), false);
      } catch (Exception e) {
        LOG.error("任务 {} 执行失败", job.getId(), e);
      }
    }
  }
}
