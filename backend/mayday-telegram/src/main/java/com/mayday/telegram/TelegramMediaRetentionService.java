package com.mayday.telegram;

import java.io.IOException;

import com.mayday.common.util.BusinessTime;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StoredFileContent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Deletes Telegram media objects after their configured retention period.
 *
 * <p>
 * The database claim is committed before storage I/O. A ten-minute lease allows
 * another application instance to retry after a process crash, while the
 * storage boundary guarantees that deleting a missing object is safe.
 */
@Service
public class TelegramMediaRetentionService
{
    private static final Logger LOGGER = LoggerFactory.getLogger(TelegramMediaRetentionService.class);

    private final TelegramSettings settings;
    private final TelegramMediaStateService mediaStates;
    private final StoredFileContent storedFiles;

    public TelegramMediaRetentionService(TelegramSettings settings, TelegramMediaStateService mediaStates,
            StoredFileContent storedFiles)
    {
        this.settings = settings;
        this.mediaStates = mediaStates;
        this.storedFiles = storedFiles;
    }

    /**
     * Cleans one expired media object and returns whether a row was claimed.
     *
     * @return {@code true} when a cleanup claim was handled; {@code false} when
     *         retention is disabled or no expired row is available
     */
    public boolean cleanupOne()
    {
        int retentionDays = settings.getMediaRetentionDays();
        if (retentionDays == 0)
        {
            return false;
        }

        TelegramMedia claim = mediaStates.claimExpired(BusinessTime.now().minusDays(retentionDays));
        if (claim == null)
        {
            return false;
        }

        try
        {
            if (claim.getStorageProvider() != null && claim.getStorageKey() != null)
            {
                FileStorage storage = storedFiles.storage(claim.getStorageProvider());
                storage.delete(claim.getStorageKey());
            }
            if (!mediaStates.completeRetention(claim))
            {
                LOGGER.warn("Telegram media cleanup lease was lost after storage deletion; mediaId={}", claim.getId());
            }
        } catch (IOException | RuntimeException exception)
        {
            // Keep the DELETING lease in the database; a later worker retries it.
            // Do not log provider errors because they can contain storage URLs or keys.
            LOGGER.warn("Telegram media cleanup failed; mediaId={}", claim.getId());
        }
        return true;
    }
}
