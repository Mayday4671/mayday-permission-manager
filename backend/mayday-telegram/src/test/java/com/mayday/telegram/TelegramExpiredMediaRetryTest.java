package com.mayday.telegram;

import java.util.Optional;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies retained attachment metadata can be downloaded again after expiry.
 */
class TelegramExpiredMediaRetryTest
{
    @Test
    void expiredMediaCanBeDownloadedAgainWithoutConsumingFailureRetries()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(java.util.Map.of("telegram", true));
        AccessPolicy access = mock(AccessPolicy.class);
        TelegramSettings settings = new TelegramSettings();
        TelegramMediaMapper media = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
        TelegramMedia attachment = expiredAttachment();
        TelegramCollectionTask task = downloadableTask();
        TelegramCollectedMessage source = sourceMessage();
        when(media.lock(31L)).thenReturn(Optional.of(attachment));
        when(tasks.findById(41L)).thenReturn(Optional.of(task));
        when(messages.findById(51L)).thenReturn(Optional.of(source));

        TelegramMediaDownloadService downloads = new TelegramMediaDownloadService(new TelegramModuleGuard(switches),
                access, mock(UserMapper.class), settings, mock(StorageSettings.class), mock(StoredFileContent.class),
                null, media, tasks, messages, mock(TelegramMediaStateService.class));

        var response = downloads.retry(31L);

        assertThat(response.status()).isEqualTo("QUEUED");
        assertThat(attachment.getAttemptCount()).isZero();
        assertThat(attachment.getActualSize()).isNull();
        assertThat(attachment.getMediaType()).isNull();
        assertThat(attachment.getStorageKey()).isNull();
        assertThat(attachment.getStorageProvider()).isNull();
        assertThat(attachment.getSha256()).isNull();
        verify(media).save(attachment);
    }

    private TelegramMedia expiredAttachment()
    {
        TelegramMedia attachment = new TelegramMedia();
        attachment.setId(31L);
        attachment.setOwnerId(7L);
        attachment.setDepartmentId(3L);
        attachment.setTaskId(41L);
        attachment.setMessageId(51L);
        attachment.setKind("PHOTO");
        attachment.setStatus("EXPIRED");
        attachment.setAttemptCount(3);
        attachment.setActualSize(4096L);
        attachment.setMediaType("image/png");
        attachment.setStorageProvider("LOCAL");
        attachment.setStorageKey("ab/expired-object");
        attachment.setSha256("c".repeat(64));
        return attachment;
    }

    private TelegramCollectionTask downloadableTask()
    {
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(41L);
        task.setStatus("COMPLETED");
        task.setDownloadImages(true);
        return task;
    }

    private TelegramCollectedMessage sourceMessage()
    {
        TelegramCollectedMessage source = new TelegramCollectedMessage();
        source.setId(51L);
        source.setTaskId(41L);
        source.setCanBeSaved(true);
        return source;
    }
}
