package com.mayday.telegram;

import com.mayday.common.util.ModuleSwitches;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Runs a small, isolated batch of expired Telegram media cleanup work. */
@Component
public class TelegramMediaRetentionWorker
{
    private static final int MAX_FILES_PER_RUN = 20;

    private final ModuleSwitches moduleSwitches;
    private final TelegramSettings settings;
    private final TelegramMediaRetentionService retention;

    public TelegramMediaRetentionWorker(ModuleSwitches moduleSwitches, TelegramSettings settings,
            TelegramMediaRetentionService retention)
    {
        this.moduleSwitches = moduleSwitches;
        this.settings = settings;
        this.retention = retention;
    }

    /** Keeps retention I/O off both collection and download scheduler threads. */
    @Scheduled(scheduler = "telegramMediaCleanupScheduler", fixedDelay = 60_000, initialDelay = 15_000)
    public void cleanupExpiredMedia()
    {
        if (!moduleSwitches.isEnabled("telegram") || settings.getMediaRetentionDays() == 0)
        {
            return;
        }
        for (int cleaned = 0; cleaned < MAX_FILES_PER_RUN; cleaned++)
        {
            if (!retention.cleanupOne())
            {
                return;
            }
        }
    }
}
