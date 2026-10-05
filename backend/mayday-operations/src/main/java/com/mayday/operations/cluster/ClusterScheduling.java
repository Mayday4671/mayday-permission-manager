package com.mayday.operations.cluster;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 调度扫描、队列心跳与消息消费有独立工作容量；一个短维护事务不能阻塞所有租约心跳。 */
@Configuration
public class ClusterScheduling {
  @Bean(name = "taskScheduler")
  ThreadPoolTaskScheduler taskScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(6);
    scheduler.setThreadNamePrefix("mayday-maintenance-");
    scheduler.setWaitForTasksToCompleteOnShutdown(false);
    scheduler.setRemoveOnCancelPolicy(true);
    return scheduler;
  }
}
