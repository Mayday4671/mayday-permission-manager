package com.mayday.telegram;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import com.mayday.common.util.BusinessTime;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 验证取消信号能够停止实际 TDLib 传输，又不打断同一文件被其他任务共享的下载。 */
class TelegramMediaDownloadCancellationTest
{
    private TelegramMediaDownloadService service;
    private TelegramSessionClient client;
    private TelegramCollectionTaskMapper tasks;
    private TelegramMediaMapper media;
    private TelegramCollectionTask task;
    private TelegramMedia claim;
    private TelegramSettings settings;

    @BeforeEach
    void setUp()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(java.util.Map.of("telegram", true));
        client = mock(TelegramSessionClient.class);
        tasks = mock(TelegramCollectionTaskMapper.class);
        media = mock(TelegramMediaMapper.class);
        settings = new TelegramSettings();
        service = new TelegramMediaDownloadService(new TelegramModuleGuard(switches), mock(AccessPolicy.class),
                mock(UserMapper.class), settings, mock(StorageSettings.class), mock(StoredFileContent.class),
                mock(TelegramSessionCoordinator.class), media, tasks, mock(TelegramCollectedMessageMapper.class),
                mock(TelegramMediaStateService.class));
        task = new TelegramCollectionTask();
        task.setId(21L);
        task.setStatus("COMPLETED");
        claim = new TelegramMedia();
        claim.setId(31L);
        claim.setTaskId(21L);
        claim.setTelegramFileId(44);
        claim.setStatus("DOWNLOADING");
        claim.setLeaseOwner("download-worker");
        claim.setLeaseExpiresAt(BusinessTime.now().plusMinutes(10));
        when(tasks.findById(21L)).thenReturn(Optional.of(task));
        when(media.findById(31L)).thenReturn(Optional.of(claim));
    }

    @Test
    void cancelsAnInFlightTransferOnTheNextShortPoll()
    {
        TelegramCollectionTask cancelled = new TelegramCollectionTask();
        cancelled.setId(21L);
        cancelled.setStatus("CANCELLED");
        when(tasks.findById(21L)).thenReturn(Optional.of(task), Optional.of(task), Optional.of(cancelled));
        when(client.downloadFile(44, settings.getMaxMediaFileBytes())).thenReturn(new CompletableFuture<>());

        assertTimeoutPreemptively(Duration.ofSeconds(3),
                () -> assertThatThrownBy(() -> service.downloadWithTimeout(client, claim))
                        .hasMessageContaining("附件下载已停止"));

        verify(client).cancelDownloadFile(44);
    }

    @Test
    void doesNotStartACancelledDownload()
    {
        task.setStatus("CANCELLED");

        assertThatThrownBy(() -> service.downloadWithTimeout(client, claim)).hasMessageContaining("附件下载已停止");

        verify(client, never()).downloadFile(anyInt(), anyLong());
        verify(client).cancelDownloadFile(44);
    }

    @Test
    void keepsSharedTelegramTransferAliveForAnotherActiveTask()
    {
        task.setStatus("CANCELLED");
        when(media.otherActiveDownloads(44, 31L)).thenReturn(1L);

        assertThatThrownBy(() -> service.downloadWithTimeout(client, claim)).hasMessageContaining("附件下载已停止");

        verify(client, never()).cancelDownloadFile(44);
    }

    @Test
    void staleWorkerDoesNotCancelTheReplacementLeaseOnTheSameMediaRow()
    {
        TelegramMedia replacement = new TelegramMedia();
        replacement.setId(31L);
        replacement.setTelegramFileId(44);
        replacement.setStatus("DOWNLOADING");
        replacement.setLeaseOwner("replacement-worker");
        replacement.setLeaseExpiresAt(BusinessTime.now().plusMinutes(10));
        when(media.findById(31L)).thenReturn(Optional.of(replacement));

        assertThatThrownBy(() -> service.downloadWithTimeout(client, claim)).hasMessageContaining("下载租约已失效");

        verify(client, never()).downloadFile(anyInt(), anyLong());
        verify(client, never()).cancelDownloadFile(44);
    }

    @Test
    void returnsCompletedBytesOnlyWhileTheTaskAndLeaseRemainValid()
    {
        TelegramDownloadedFile file = new TelegramDownloadedFile(Path.of("sample.mp4"), 128);
        when(client.downloadFile(44, settings.getMaxMediaFileBytes()))
                .thenReturn(CompletableFuture.completedFuture(file));

        assertThat(service.downloadWithTimeout(client, claim)).isSameAs(file);

        verify(client, never()).cancelDownloadFile(44);
    }
}
