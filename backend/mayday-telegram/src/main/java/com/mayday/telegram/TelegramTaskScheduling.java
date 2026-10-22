package com.mayday.telegram;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Provides an isolated scheduler so a slow Telegram request cannot block
 * unrelated jobs.
 */
@Configuration
public class TelegramTaskScheduling
{
    private final TelegramSettings settings;

    public TelegramTaskScheduling(TelegramSettings settings)
    {
        this.settings = settings;
    }

    /**
     * Creates one bounded worker thread; database leases coordinate other app
     * instances.
     */
    @Bean(name = "telegramTaskScheduler", defaultCandidate = false)
    ThreadPoolTaskScheduler telegramTaskScheduler()
    {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("mayday-telegram-task-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(20);
        return scheduler;
    }

    /**
     * Keeps large binary transfers from blocking bounded history-page collection.
     */
    @Bean(name = "telegramMediaScheduler", defaultCandidate = false)
    ThreadPoolTaskScheduler telegramMediaScheduler()
    {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("mayday-telegram-media-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }

    /**
     * Keeps object-store cleanup latency away from collection and download work.
     */
    @Bean(name = "telegramMediaCleanupScheduler", defaultCandidate = false)
    ThreadPoolTaskScheduler telegramMediaCleanupScheduler()
    {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("mayday-telegram-cleanup-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }

    /**
     * Keeps CPU-heavy, bounded video preview generation away from Telegram IO
     * workers.
     */
    @Bean(name = "telegramVideoPreviewScheduler", defaultCandidate = false)
    ThreadPoolTaskScheduler telegramVideoPreviewScheduler()
    {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("mayday-telegram-video-preview-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }

    /** Creates a bounded download pool separate from the polling schedulers. */
    @Bean(name = "telegramMediaExecutor", destroyMethod = "shutdown")
    ThreadPoolTaskExecutor telegramMediaExecutor()
    {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(settings.getMaxMediaWorkers());
        executor.setMaxPoolSize(settings.getMaxMediaWorkers());
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("mayday-telegram-media-worker-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
