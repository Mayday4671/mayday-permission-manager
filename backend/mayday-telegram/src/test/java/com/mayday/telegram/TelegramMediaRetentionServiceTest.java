package com.mayday.telegram;

import java.io.IOException;

import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StoredFileContent;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies retention cleanup is idempotent and never marks failed deletes
 * complete.
 */
class TelegramMediaRetentionServiceTest
{
    @Test
    void deletesTheStoredObjectBeforeCompletingTheRetentionClaim() throws IOException
    {
        TelegramSettings settings = new TelegramSettings();
        TelegramMediaStateService states = mock(TelegramMediaStateService.class);
        StoredFileContent files = mock(StoredFileContent.class);
        FileStorage storage = mock(FileStorage.class);
        TelegramMedia claim = claim();
        when(states.claimExpired(any())).thenReturn(claim);
        when(files.storage("LOCAL")).thenReturn(storage);

        TelegramMediaRetentionService retention = new TelegramMediaRetentionService(settings, states, files);

        assertThat(retention.cleanupOne()).isTrue();
        verify(storage).delete("ab/00000000-0000-0000-0000-000000000000");
        verify(states).completeRetention(claim);
    }

    @Test
    void leavesTheCleanupLeaseForRetryWhenStorageDeleteFails() throws IOException
    {
        TelegramSettings settings = new TelegramSettings();
        TelegramMediaStateService states = mock(TelegramMediaStateService.class);
        StoredFileContent files = mock(StoredFileContent.class);
        FileStorage storage = mock(FileStorage.class);
        TelegramMedia claim = claim();
        when(states.claimExpired(any())).thenReturn(claim);
        when(files.storage("LOCAL")).thenReturn(storage);
        doThrow(new IOException("storage details must not be logged")).when(storage).delete(claim.getStorageKey());

        TelegramMediaRetentionService retention = new TelegramMediaRetentionService(settings, states, files);

        assertThat(retention.cleanupOne()).isTrue();
        verify(states, never()).completeRetention(claim);
    }

    @Test
    void doesNotClaimRowsWhenRetentionIsDisabled()
    {
        TelegramSettings settings = new TelegramSettings();
        settings.setMediaRetentionDays(0);
        TelegramMediaStateService states = mock(TelegramMediaStateService.class);
        TelegramMediaRetentionService retention = new TelegramMediaRetentionService(settings, states,
                mock(StoredFileContent.class));

        assertThat(retention.cleanupOne()).isFalse();
        verify(states, never()).claimExpired(any());
    }

    private TelegramMedia claim()
    {
        TelegramMedia media = new TelegramMedia();
        media.setId(17L);
        media.setStatus("DELETING");
        media.setStorageProvider("LOCAL");
        media.setStorageKey("ab/00000000-0000-0000-0000-000000000000");
        media.setLeaseOwner("retention-worker");
        return media;
    }
}
