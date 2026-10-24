package com.mayday.telegram;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import com.mayday.common.util.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Publication must apply the same video/document policy as queue admission. */
class TelegramVideoPreviewStatePolicyTest
{
    private final AccessPolicy access = mock(AccessPolicy.class);
    private final UserMapper users = mock(UserMapper.class);
    private final TelegramMediaMapper media = mock(TelegramMediaMapper.class);
    private final TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
    private final TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
    private final TelegramVideoPreviewMapper previews = mock(TelegramVideoPreviewMapper.class);
    private final TelegramVideoPreviewAssetMapper assets = mock(TelegramVideoPreviewAssetMapper.class);
    private final TelegramVideoPreviewStateService service = new TelegramVideoPreviewStateService(access, users, media,
            tasks, messages, previews, assets);
    private TelegramVideoPreview preview;
    private TelegramCollectionTask task;
    private TelegramCollectedMessage message;

    @BeforeEach
    void setUp()
    {
        SysUser owner = new SysUser();
        owner.setId(1L);
        preview = new TelegramVideoPreview();
        preview.setId(10L);
        preview.setMediaId(9L);
        preview.setOwnerId(1L);
        preview.setDepartmentId(2L);
        preview.setStatus("PROCESSING");
        preview.setLeaseOwner("worker");
        preview.setLeaseExpiresAt(BusinessTime.now().plusMinutes(1));
        TelegramMedia source = new TelegramMedia();
        source.setId(9L);
        source.setOwnerId(1L);
        source.setDepartmentId(2L);
        source.setTaskId(4L);
        source.setMessageId(5L);
        source.setStatus("AVAILABLE");
        source.setStorageProvider("LOCAL");
        source.setStorageKey("telegram/source");
        source.setKind("DOCUMENT");
        source.setMediaType("application/octet-stream");
        source.setFileName("clip.mkv");
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
        when(previews.lockByMediaId(9L)).thenReturn(Optional.of(preview));
        when(media.findById(9L)).thenReturn(Optional.of(source));
        when(tasks.findById(4L)).thenReturn(Optional.of(task));
        when(messages.findById(5L)).thenReturn(Optional.of(message));
        when(users.findById(1L)).thenReturn(Optional.of(owner));
        when(access.hasFor(owner, "telegram:view")).thenReturn(true);
        when(access.hasFor(owner, "telegram:download")).thenReturn(true);
        when(access.containsFor(owner, "telegram", 1L, 2L)).thenReturn(true);
    }

    @Test
    void publishesConvertedDocumentVideoUsingDocumentDownloadPolicy()
    {
        assertThat(publish()).isTrue();
        assertThat(preview.getStatus()).isEqualTo("READY");
        verify(assets).save(any(TelegramVideoPreviewAsset.class));
    }

    @Test
    void doesNotPublishAfterDocumentPermissionWasRemoved()
    {
        task.setDownloadDocuments(false);
        task.setDownloadVideos(true);

        assertThat(publish()).isFalse();
        verify(assets, never()).save(any(TelegramVideoPreviewAsset.class));
    }

    @Test
    void doesNotPublishProtectedOrReassignedSourceMessages()
    {
        message.setCanBeSaved(false);
        assertThat(publish()).isFalse();
        message.setCanBeSaved(true);
        message.setOwnerId(3L);
        assertThat(publish()).isFalse();
        verify(assets, never()).save(any(TelegramVideoPreviewAsset.class));
    }

    private boolean publish()
    {
        return service.publish(preview,
                new TelegramVideoPreviewProcessor.ProbeResult(BigDecimal.TEN, "h264", "aac", 640, 360, "yuv420p"),
                List.of(new TelegramVideoPreviewAsset()));
    }
}
