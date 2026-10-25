package com.mayday.telegram;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.util.ModuleSwitches;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * Verifies gallery covers share media authorization and never download full
 * videos.
 */
class TelegramMediaThumbnailTest
{
    private final AccessPolicy access = mock(AccessPolicy.class);
    private final TelegramSessionCoordinator sessions = mock(TelegramSessionCoordinator.class);
    private final TelegramSessionClient client = mock(TelegramSessionClient.class);
    private final TelegramMediaMapper media = mock(TelegramMediaMapper.class);
    private final TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
    private final TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
    private final TelegramCollectedMessage source = new TelegramCollectedMessage();
    private final TelegramCollectionTask task = new TelegramCollectionTask();
    private final TelegramMedia attachment = new TelegramMedia();
    private TelegramMediaDownloadService service;

    @BeforeEach
    void setup()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(Map.of("telegram", true));
        attachment.setId(1L);
        attachment.setOwnerId(2L);
        attachment.setDepartmentId(3L);
        attachment.setMessageId(4L);
        attachment.setTaskId(5L);
        attachment.setAttachmentIndex(0);
        attachment.setKind("VIDEO");
        attachment.setStatus("REMOTE");
        attachment.setTelegramFileId(123);
        source.setTaskId(5L);
        source.setChatId("-10001");
        source.setTelegramMessageId("100");
        source.setCanBeSaved(true);
        task.setPreviewOnly(true);
        task.setStatus("COMPLETED");
        task.setMessageLink("https://t.me/telegram/1");
        when(media.findById(1L)).thenReturn(Optional.of(attachment));
        when(messages.findById(4L)).thenReturn(Optional.of(source));
        when(tasks.findById(5L)).thenReturn(Optional.of(task));
        when(sessions.requireMediaClient(2L)).thenReturn(client);
        when(client.resolveMediaFile(task.getMessageLink(), "-10001", "100", 0))
                .thenReturn(CompletableFuture.completedFuture(456));
        when(client.channelThumbnail("-10001", "100")).thenReturn(CompletableFuture.completedFuture(new byte[]
        {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0}));
        service = new TelegramMediaDownloadService(new TelegramModuleGuard(switches), access, mock(UserMapper.class),
                new TelegramSettings(), mock(StorageSettings.class), mock(StoredFileContent.class), sessions, media,
                tasks, messages, mock(TelegramMediaStateService.class));
    }

    @Test
    void publicSearchCoverResolvesCurrentSourceBeforeReadingSmallThumbnail()
    {
        assertThat(service.thumbnail(1L)).hasSize(4);
        verify(access).require("telegram:view");
        verify(access).require("telegram:download");
        verify(access).checkData("telegram", 2L, 3L);
        var order = inOrder(client);
        order.verify(client).resolveMediaFile(task.getMessageLink(), "-10001", "100", 0);
        order.verify(client).channelThumbnail("-10001", "100");
        verifyNoMoreInteractions(client);
        verify(media, never()).save(any());
    }

    @Test
    void revokedDownloadPermissionNeverContactsTelegram()
    {
        doThrow(new AccessDeniedException("denied")).when(access).require("telegram:download");
        assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(client, sessions);
    }

    @Test
    void anotherOwnersMediaIsDeniedBeforeResolvingTheSource()
    {
        doThrow(new AccessDeniedException("denied")).when(access).checkData("telegram", 2L, 3L);
        assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(client, sessions);
    }

    @Test
    void protectedOrCancelledSourceDoesNotExposeCover()
    {
        source.setCanBeSaved(false);
        assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(AccessDeniedException.class);
        source.setCanBeSaved(true);
        task.setStatus("CANCELLED");
        assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(client, sessions);
    }

    @Test
    void changedSourceDoesNotFallBackToStaleNativeHandle()
    {
        when(client.resolveMediaFile(task.getMessageLink(), "-10001", "100", 0))
                .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("private native error")));
        assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(BusinessException.class)
                .hasMessageNotContaining("private native error");
        verify(client, never()).channelThumbnail(any(), any());
    }

    @Test
    void oversizedAndNonRasterResponsesAreRejected()
    {
        for (byte[] bytes : new byte[][]
        {new byte[(int) TelegramChannelThumbnail.MAX_BYTES + 1], "<html>".getBytes()})
        {
            when(client.channelThumbnail("-10001", "100")).thenReturn(CompletableFuture.completedFuture(bytes));
            assertThatThrownBy(() -> service.thumbnail(1L)).isInstanceOf(BusinessException.class);
        }
    }
}
