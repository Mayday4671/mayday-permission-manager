package com.mayday.telegram;

import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

import com.mayday.common.util.ModuleSwitches;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Downloads explicitly selected attachments on a bounded set of dedicated
 * workers.
 */
@Component
public class TelegramMediaWorker
{
    private final ModuleSwitches modules;
    private final TelegramMediaDownloadService downloads;
    private final TelegramSettings settings;
    private final TaskExecutor telegramMediaExecutor;
    private final AtomicInteger activeWorkers = new AtomicInteger();

    /**
     * Binds the dedicated bounded executor without exposing it as a generic app
     * pool.
     */
    public TelegramMediaWorker(ModuleSwitches modules, TelegramMediaDownloadService downloads,
            TelegramSettings settings, @Qualifier("telegramMediaExecutor") TaskExecutor telegramMediaExecutor)
    {
        this.modules = modules;
        this.downloads = downloads;
        this.settings = settings;
        this.telegramMediaExecutor = telegramMediaExecutor;
    }

    /**
     * A dedicated scheduler prevents a large media transfer from pausing history
     * pagination.
     */
    @Scheduled(scheduler = "telegramMediaScheduler", fixedDelayString = "${mayday.telegram.media-delay-ms:1000}", initialDelay = 6000)
    public void tick()
    {
        if (!modules.isEnabled("telegram"))
        {
            return;
        }
        while (activeWorkers.get() < settings.getMaxMediaWorkers())
        {
            TelegramMedia claim = downloads.claimNext();
            if (claim == null)
            {
                return;
            }
            activeWorkers.incrementAndGet();
            try
            {
                telegramMediaExecutor.execute(() -> {
                    try
                    {
                        downloads.download(claim);
                    } finally
                    {
                        activeWorkers.decrementAndGet();
                    }
                });
            } catch (RejectedExecutionException exception)
            {
                activeWorkers.decrementAndGet();
                downloads.releaseForQueue(claim);
                return;
            }
        }
    }
}
