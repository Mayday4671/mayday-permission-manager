package com.mayday.telegram;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Polls the durable preview queue. A single dedicated scheduler bounds CPU and
 * disk pressure; database row leases coordinate application instances.
 */
@Component
@RequiredArgsConstructor
class TelegramVideoPreviewWorker
{
    private static final Logger LOGGER = LoggerFactory.getLogger(TelegramVideoPreviewWorker.class);
    private static final int MAX_CLEANUPS_PER_POLL = 8;

    private final TelegramModuleGuard moduleGuard;
    private final TelegramVideoPreviewService previews;

    /** Processes at most one video and a small cleanup batch per scheduler turn. */
    @Scheduled(scheduler = "telegramVideoPreviewScheduler", fixedDelay = 1_000, initialDelay = 12_000)
    void poll()
    {
        if (!moduleGuard.isEnabled())
        {
            return;
        }
        try
        {
            TelegramVideoPreview claim = previews.claimNext();
            if (claim != null)
            {
                previews.process(claim);
            }
            for (int count = 0; count < MAX_CLEANUPS_PER_POLL && previews.cleanupExpiredOne(); count++)
            {
                // Each cleanup claims and commits one row before touching object storage.
            }
        } catch (RuntimeException exception)
        {
            // Class names and code locations aid diagnosis without exposing SQL parameters,
            // native exception messages, storage URLs or account credentials.
            StackTraceElement location = java.util.Arrays.stream(exception.getStackTrace())
                    .filter(frame -> frame.getClassName().startsWith("com.mayday.")).findFirst().orElse(null);
            LOGGER.warn("Telegram video preview worker poll failed; type={}, location={}; retrying next turn",
                    exception.getClass().getSimpleName(), location);
        }
    }
}
