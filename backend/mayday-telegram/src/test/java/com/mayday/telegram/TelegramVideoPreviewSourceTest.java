package com.mayday.telegram;

import java.util.Optional;

import com.mayday.common.exception.BusinessException;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies that broader container support preserves the original ownership and
 * collection policies.
 */
class TelegramVideoPreviewSourceTest
{
    private final TelegramMediaMapper mediaMapper = mock(TelegramMediaMapper.class);
    private final TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
    private final TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
    private final TelegramVideoPreviewMapper previews = mock(TelegramVideoPreviewMapper.class);
    private TelegramVideoPreviewService service;
    private TelegramMedia source;
    private TelegramCollectionTask task;
    private TelegramCollectedMessage message;

    @BeforeEach
    void setUp()
    {
        service = new TelegramVideoPreviewService(mock(TelegramModuleGuard.class), mock(AccessPolicy.class),
                mock(UserMapper.class), new TelegramSettings(), mock(StorageSettings.class),
                mock(StoredFileContent.class), mediaMapper, tasks, messages, previews,
                mock(TelegramVideoPreviewAssetMapper.class), mock(TelegramVideoPreviewStateService.class),
                mock(TelegramVideoPreviewProcessor.class));
        source = new TelegramMedia();
        source.setId(9L);
        source.setTaskId(4L);
        source.setMessageId(5L);
        source.setOwnerId(1L);
        source.setDepartmentId(2L);
        source.setStatus("AVAILABLE");
        source.setStorageProvider("LOCAL");
        source.setStorageKey("telegram/source");
        source.setKind("DOCUMENT");
        source.setMediaType("application/octet-stream");
        source.setFileName("sample.mkv");
        task = new TelegramCollectionTask();
        task.setId(4L);
        task.setOwnerId(1L);
        task.setDepartmentId(2L);
        task.setStatus("COMPLETED");
        task.setDownloadDocuments(true);
        task.setDownloadVideos(false);
        message = new TelegramCollectedMessage();
        message.setId(5L);
        message.setTaskId(4L);
        message.setOwnerId(1L);
        message.setDepartmentId(2L);
        message.setCanBeSaved(true);
        when(mediaMapper.lock(9L)).thenReturn(Optional.of(source));
        when(tasks.findById(4L)).thenReturn(Optional.of(task));
        when(messages.findById(5L)).thenReturn(Optional.of(message));
        when(previews.lockBudget()).thenReturn(1);
        when(previews.lockByMediaId(9L)).thenReturn(Optional.empty());
    }

    @Test
    void queuesDownloadedDocumentVideoWithDocumentOptIn()
    {
        assertThat(service.request(9L).status()).isEqualTo("QUEUED");
        verify(previews).save(any(TelegramVideoPreview.class));
    }

    @Test
    void rejectsDocumentVideoWhenOnlyVideoDownloadsAreAllowed()
    {
        task.setDownloadDocuments(false);
        task.setDownloadVideos(true);

        assertDenied();
    }

    @Test
    void rejectsProtectedMessagesEvenWhenDocumentDownloadsAreEnabled()
    {
        message.setCanBeSaved(false);

        assertDenied();
    }

    @Test
    void rejectsChangedOwnershipAndUnrelatedMessageReferences()
    {
        message.setOwnerId(3L);
        assertDenied();
        message.setOwnerId(1L);
        message.setTaskId(8L);
        assertDenied();
        message.setTaskId(4L);
        task.setDepartmentId(3L);
        assertDenied();
    }

    @Test
    void rejectsCancelledTasksAndUnavailableFiles()
    {
        task.setStatus("CANCELLED");
        assertDenied();
        task.setStatus("COMPLETED");
        source.setStatus("DELETING");
        assertThatThrownBy(() -> service.request(9L)).isInstanceOf(BusinessException.class);
        verify(previews, never()).lockBudget();
    }

    private void assertDenied()
    {
        assertThatThrownBy(() -> service.request(9L)).isInstanceOf(AccessDeniedException.class);
        verify(previews, never()).lockBudget();
    }
}
