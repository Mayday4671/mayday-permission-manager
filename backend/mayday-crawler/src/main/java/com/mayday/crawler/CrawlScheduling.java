package com.mayday.crawler;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 外站慢请求使用独立的单线程调度器，不占用审批通知、内容定时发布等业务调度线程。 */
@Configuration
public class CrawlScheduling {
  @Bean(name="crawlerScheduler", defaultCandidate=false)
  ThreadPoolTaskScheduler crawlerScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("crawler-");
    scheduler.setWaitForTasksToCompleteOnShutdown(false);
    return scheduler;
  }
}
