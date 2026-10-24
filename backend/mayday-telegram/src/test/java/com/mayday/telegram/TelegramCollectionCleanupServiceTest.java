package com.mayday.telegram;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

import com.mayday.common.util.BusinessTime;
import com.mayday.common.util.ModuleSwitches;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 验证删除任务时的 HLS 外键顺序、持久化隔离状态、租约冲突和失败重试。 */
class TelegramCollectionCleanupServiceTest
{
    private AccessPolicy access;
    private TelegramCollectionTaskMapper tasks;
    private TelegramCollectedMessageMapper messages;
    private TelegramMediaMapper media;
    private TelegramVideoPreviewMapper previews;
    private TelegramVideoPreviewAssetMapper assets;
    private FileStorage storage;
    private PlatformTransactionManager transactionManager;
    private TelegramCollectionCleanupService service;
    private TelegramCollectionTask task;
    private TelegramMedia attachment;
    private TelegramVideoPreview preview;

    @BeforeEach
    void setUp()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(java.util.Map.of("telegram", true));
        access = mock(AccessPolicy.class);
        tasks = mock(TelegramCollectionTaskMapper.class);
        messages = mock(TelegramCollectedMessageMapper.class);
        media = mock(TelegramMediaMapper.class);
        previews = mock(TelegramVideoPreviewMapper.class);
        assets = mock(TelegramVideoPreviewAssetMapper.class);
        StoredFileContent files = mock(StoredFileContent.class);
        storage = mock(FileStorage.class);
        when(files.storage("local")).thenReturn(storage);
        transactionManager = mock(PlatformTransactionManager.class);
        when(transactionManager.getTransaction(any())).thenAnswer(ignored -> new SimpleTransactionStatus());
        service = new TelegramCollectionCleanupService(new TelegramModuleGuard(switches), access, tasks, messages,
                media, previews, assets, files, new TransactionTemplate(transactionManager));

        task = new TelegramCollectionTask();
        task.setId(21L);
        task.setOwnerId(7L);
        task.setDepartmentId(3L);
        task.setStatus("COMPLETED");
        task.setTrackingEnabled(true);
        when(tasks.lock(21L)).thenReturn(Optional.of(task));
        attachment = new TelegramMedia();
        attachment.setId(31L);
        attachment.setTaskId(21L);
        attachment.setOwnerId(7L);
        attachment.setDepartmentId(3L);
        attachment.setStatus("AVAILABLE");
        attachment.setStorageProvider("local");
        attachment.setStorageKey("telegram/source.mp4");
        attachment.setStreamTicketHash("old-ticket-digest");
        attachment.setStreamTicketExpiresAt(BusinessTime.now().plusMinutes(10));
        when(media.lockForTask(21L)).thenReturn(List.of(attachment));
        preview = new TelegramVideoPreview();
        preview.setId(41L);
        preview.setMediaId(31L);
        preview.setOwnerId(7L);
        preview.setDepartmentId(3L);
        preview.setStatus("READY");
        when(previews.lockByMediaId(31L)).thenReturn(Optional.of(preview));
        TelegramVideoPreviewAsset asset = new TelegramVideoPreviewAsset();
        asset.setId(51L);
        asset.setPreviewId(41L);
        asset.setStorageProvider("local");
        asset.setStorageKey("telegram/hls/segment_00000.ts");
        when(assets.lockForPreview(41L)).thenReturn(List.of(asset));
    }

    @Test
    void commitsUnreadableStateBeforeStorageIoAndDeletesHlsBeforeItsParent() throws IOException
    {
        doAnswer(ignored -> {
            assertThat(attachment.getStatus()).isEqualTo("DELETING");
            assertThat(preview.getStatus()).isEqualTo("DELETING");
            assertThat(attachment.getStreamTicketHash()).isNull();
            assertThat(task.getTrackingEnabled()).isFalse();
            return null;
        }).when(storage).delete(any());

        service.delete(21L);

        var order = inOrder(transactionManager, storage, assets, previews, media, messages, tasks);
        order.verify(transactionManager).commit(any());
        order.verify(storage).delete("telegram/hls/segment_00000.ts");
        order.verify(storage).delete("telegram/source.mp4");
        order.verify(assets).deleteByQuery(any());
        order.verify(previews).deleteById(41L);
        order.verify(media).deleteByQuery(any());
        order.verify(messages).deleteByQuery(any());
        order.verify(tasks).deleteById(21L);
        order.verify(transactionManager).commit(any());
        verify(access).require("telegram:delete");
        verify(access).checkData("telegram", 7L, 3L);
    }

    @Test
    void cleanupLeaseFitsExistingTaskMediaAndPreviewColumns()
    {
        service.delete(21L);

        assertThat(task.getLeaseOwner()).hasSize(36).matches("del:[0-9a-f]{32}");
        assertThat(attachment.getLeaseOwner()).isEqualTo(task.getLeaseOwner()).hasSize(36);
        assertThat(preview.getLeaseOwner()).isEqualTo(task.getLeaseOwner()).hasSize(36);
    }

    @Test
    void failedStorageDeleteKeepsReferencesUnreadableAndCanBeRetried() throws IOException
    {
        doThrow(new IOException("storage unavailable")).when(storage).delete("telegram/source.mp4");

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("重试删除");

        assertThat(attachment.getStatus()).isEqualTo("DELETING");
        assertThat(preview.getStatus()).isEqualTo("DELETING");
        assertThat(attachment.getStorageKey()).isEqualTo("telegram/source.mp4");
        assertThat(task.getLeaseExpiresAt()).isBefore(BusinessTime.now());
        verify(media, never()).deleteByQuery(any());
        verify(previews, never()).deleteById(any());
        verify(tasks, never()).deleteById(any());

        doNothing().when(storage).delete("telegram/source.mp4");
        service.delete(21L);

        verify(tasks).deleteById(21L);
    }

    @Test
    void fencesQueuedOrRunningPreviewBeforeRemovingItsSource()
    {
        preview.setStatus("PROCESSING");
        preview.setLeaseOwner("old-transcoder");
        preview.setLeaseExpiresAt(BusinessTime.now().plusMinutes(5));

        service.delete(21L);

        assertThat(preview.getStatus()).isEqualTo("DELETING");
        assertThat(preview.getLeaseOwner()).startsWith("del:").isNotEqualTo("old-transcoder");
        assertThat(preview.getReservedBytes()).isZero();
        verify(previews).deleteById(41L);
    }

    @Test
    void refusesToDeleteTaskOutsideCurrentDataScope() throws IOException
    {
        doThrow(new AccessDeniedException("scope")).when(access).checkData("telegram", 7L, 3L);

        assertThatThrownBy(() -> service.delete(21L)).isInstanceOf(AccessDeniedException.class);

        verify(storage, never()).delete(any());
        verify(tasks, never()).save(any());
        verify(tasks, never()).deleteById(any());
    }

    @Test
    void refusesAnActiveCollectionBeforeStorageIsTouched() throws IOException
    {
        task.setStatus("RUNNING");

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("请先取消或等待任务结束");

        verify(storage, never()).delete(any());
        verify(tasks, never()).save(any());
    }

    @Test
    void refusesActiveAttachmentCleanupOwnedByAnotherWorker() throws IOException
    {
        attachment.setStatus("DELETING");
        attachment.setLeaseOwner("retention-worker");
        attachment.setLeaseExpiresAt(BusinessTime.now().plusMinutes(3));

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("清理仍在处理中");

        verify(storage, never()).delete(any());
        verify(tasks, never()).save(any());
    }

    @Test
    void rejectsConcurrentDeletionBeforeStorageIsTouched() throws IOException
    {
        task.setLeaseOwner("del:00000000000000000000000000000001");
        task.setLeaseExpiresAt(BusinessTime.now().plusMinutes(3));

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("正在清理");

        verify(storage, never()).delete(any());
        verify(tasks, never()).save(any());
    }

    @Test
    void failedDatabaseFinalizationNeverRestoresAlreadyDeletedFilesAsAvailable()
    {
        doThrow(new org.springframework.dao.DataIntegrityViolationException("foreign key")).when(media)
                .deleteByQuery(any());

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("记录已保留");

        assertThat(attachment.getStatus()).isEqualTo("DELETING");
        assertThat(preview.getStatus()).isEqualTo("DELETING");
        assertThat(task.getLeaseExpiresAt()).isBefore(BusinessTime.now());
        verify(tasks, never()).deleteById(any());
    }
}
