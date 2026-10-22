package com.mayday.telegram;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression tests for the user-selected anchor and safe history pagination.
 */
class TelegramCollectionServiceTest
{
    private TelegramCollectionTaskMapper tasks;
    private TelegramMediaMapper media;
    private TelegramCollectedMessageMapper messages;
    private AccessPolicy access;
    private UserMapper users;
    private TelegramCollectionService service;
    private TelegramCollectionTask persisted;
    private TelegramCollectionTask claimed;

    @BeforeEach
    void setUp()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(java.util.Map.of("telegram", true));
        access = mock(AccessPolicy.class);
        users = mock(UserMapper.class);
        tasks = mock(TelegramCollectionTaskMapper.class);
        messages = mock(TelegramCollectedMessageMapper.class);
        media = mock(TelegramMediaMapper.class);
        service = new TelegramCollectionService(new TelegramModuleGuard(switches), access, users, null, tasks, messages,
                mock(TelegramMediaQueueService.class), media,
                mock(com.mayday.operations.storage.StoredFileContent.class));

        SysUser owner = new SysUser();
        owner.setId(7L);
        when(users.findById(7L)).thenReturn(Optional.of(owner));
        when(access.hasFor(owner, "telegram:collect")).thenReturn(true);
        when(access.hasFor(owner, "telegram:view")).thenReturn(true);
        when(access.containsFor(owner, "telegram", 7L, 3L)).thenReturn(true);
        persisted = new TelegramCollectionTask();
        persisted.setId(21L);
        persisted.setOwnerId(7L);
        persisted.setDepartmentId(3L);
        persisted.setMessageLink("https://t.me/example/10");
        persisted.setStatus("RUNNING");
        persisted.setLeaseOwner("lease-token");
        persisted.setLeaseExpiresAt(com.mayday.common.util.BusinessTime.now().plusMinutes(1));
        persisted.setMaxMessages(10);
        persisted.setCollectedMessages(0);
        doReturn(Optional.of(persisted)).when(tasks).lock(21L);
        claimed = new TelegramCollectionTask();
        claimed.setId(21L);
        claimed.setOwnerId(7L);
        claimed.setDepartmentId(3L);
        claimed.setStatus("RUNNING");
        claimed.setLeaseOwner("lease-token");
        claimed.setLeaseExpiresAt(com.mayday.common.util.BusinessTime.now().plusMinutes(1));
        claimed.setChatId("55");
        claimed.setStartMessageId("10");
        claimed.setCursorMessageId("10");
    }

    @Test
    void firstPageIncludesTheExactLinkedMessageAndContinuesBeforeIt()
    {
        when(messages.findMessage(21L, "55", "10")).thenReturn(Optional.empty());
        when(messages.findMessage(21L, "55", "9")).thenReturn(Optional.empty());
        when(messages.findMessage(21L, "55", "8")).thenReturn(Optional.empty());

        service.commitPage(claimed, List.of(snapshot("10"), snapshot("9"), snapshot("8")));

        assertThat(persisted.getStatus()).isEqualTo("QUEUED");
        assertThat(persisted.getCollectedMessages()).isEqualTo(3);
        assertThat(persisted.getScannedMessages()).isEqualTo(3);
        assertThat(persisted.getCursorMessageId()).isEqualTo("8");
        assertThat(persisted.getStartMessageId()).isEqualTo("10");
    }

    @Test
    void firstPageWithoutLinkedAnchorFailsEvenWhenHistoryIsEmpty()
    {
        assertThat(tasks.lock(21L)).contains(persisted);
        service.commitPage(claimed, List.of());

        assertThat(persisted.getStatus()).isEqualTo("FAILED");
        assertThat(persisted.getStatusMessage()).contains("未返回链接指定的消息");
        assertThat(persisted.getCollectedMessages()).isZero();
    }

    @Test
    void channelSourceStartsAtNewestMessageAndAppliesInclusiveBusinessDateRange()
    {
        persisted.setMessageLink(null);
        persisted.setChatId("55");
        persisted.setStartMessageId(null);
        persisted.setCursorMessageId("0");
        persisted.setFromDate(LocalDate.of(2026, 10, 1));
        persisted.setToDate(LocalDate.of(2026, 10, 2));
        claimed.setMessageLink(null);
        claimed.setStartMessageId(null);
        claimed.setCursorMessageId("0");
        when(messages.findMessage(21L, "55", "9")).thenReturn(Optional.empty());

        service.commitPage(claimed, List.of(snapshotAt("10", LocalDate.of(2026, 10, 3)),
                snapshotAt("9", LocalDate.of(2026, 10, 2)), snapshotAt("8", LocalDate.of(2026, 9, 30))));

        assertThat(persisted.getCollectedMessages()).isEqualTo(1);
        assertThat(persisted.getScannedMessages()).isEqualTo(3);
        assertThat(persisted.getCursorMessageId()).isEqualTo("8");
        assertThat(persisted.getStatus()).isEqualTo("COMPLETED");
        assertThat(persisted.getStatusMessage()).contains("开始日期");
        verify(messages)
                .save(org.mockito.ArgumentMatchers.argThat(message -> "9".equals(message.getTelegramMessageId())));
    }

    @Test
    void channelSourceAdvancesPastMessagesNewerThanTheInclusiveEndDate()
    {
        persisted.setMessageLink(null);
        persisted.setChatId("55");
        persisted.setStartMessageId(null);
        persisted.setCursorMessageId("0");
        persisted.setToDate(LocalDate.of(2026, 10, 2));
        claimed.setMessageLink(null);
        claimed.setStartMessageId(null);
        claimed.setCursorMessageId("0");

        service.commitPage(claimed, List.of(snapshotAt("10", LocalDate.of(2026, 10, 3))));

        assertThat(persisted.getCollectedMessages()).isZero();
        assertThat(persisted.getScannedMessages()).isEqualTo(1);
        assertThat(persisted.getCursorMessageId()).isEqualTo("10");
        assertThat(persisted.getStatus()).isEqualTo("QUEUED");
    }

    @Test
    void refusesToDeleteAnActiveTask()
    {
        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("请先取消或等待任务结束");

        verify(messages, never()).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(tasks, never()).deleteById(21L);
    }

    @Test
    void cancellationStopsQueuedAttachmentDownloads()
    {
        service.cancel(21L);

        assertThat(persisted.getStatus()).isEqualTo("CANCELLED");
        verify(media).cancelQueuedForTask(21L);
        verify(tasks).save(persisted);
    }

    @Test
    void deletesOnlyStoppedTaskMessagesUnderTheExplicitCleanupPermission()
    {
        persisted.setStatus("CANCELLED");

        service.delete(21L);

        verify(messages).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(tasks).deleteById(21L);
    }

    @Test
    void refusesToDeleteTaskWhileAnExpiredAttachmentIsBeingCleaned()
    {
        persisted.setStatus("CANCELLED");
        TelegramMedia attachment = new TelegramMedia();
        attachment.setStatus("DELETING");
        when(media.lockForTask(21L)).thenReturn(List.of(attachment));

        assertThatThrownBy(() -> service.delete(21L)).hasMessageContaining("清理仍在处理中");

        verify(messages, never()).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(tasks, never()).deleteById(21L);
    }

    @Test
    void refusesToDeleteTaskOutsideCurrentDataScope()
    {
        persisted.setStatus("CANCELLED");
        doThrow(new org.springframework.security.access.AccessDeniedException("数据范围外")).when(access)
                .checkData("telegram", 7L, 3L);

        assertThatThrownBy(() -> service.delete(21L)).isInstanceOf(AccessDeniedException.class);

        verify(messages, never()).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(tasks, never()).deleteById(21L);
    }

    @Test
    void enablesPeriodicCatchUpOnlyForCompletedChannelTasksAndSeedsAnIndependentCursor()
    {
        persisted.setMessageLink(null);
        persisted.setChatId("55");
        persisted.setStatus("COMPLETED");
        persisted.setCursorMessageId("20");
        when(messages.newestMessageId(21L, "55")).thenReturn(42L);

        var result = service.setTracking(21L, true);

        assertThat(result.trackingEnabled()).isTrue();
        assertThat(persisted.getTrackingEnabled()).isTrue();
        assertThat(persisted.getLiveCursorMessageId()).isEqualTo("42");
        assertThat(persisted.getCursorMessageId()).isEqualTo("20");
        assertThat(persisted.getLiveStatusMessage()).contains("定期拉取").contains("不会自动加入频道");
        verify(tasks).save(persisted);
    }

    @Test
    void refusesTrackingForMessageLinkAndDateBoundedTasks()
    {
        persisted.setStatus("COMPLETED");

        assertThatThrownBy(() -> service.setTracking(21L, true)).hasMessageContaining("消息链接任务");

        persisted.setMessageLink(null);
        persisted.setChatId("55");
        persisted.setToDate(LocalDate.of(2026, 10, 21));
        assertThatThrownBy(() -> service.setTracking(21L, true)).hasMessageContaining("设置了结束日期");
    }

    @Test
    void periodicCatchUpAdvancesOnlyItsOwnCursorAndStoresMessagesInAscendingIdOrder()
    {
        prepareTrackingLease("100");
        when(messages.findMessage(21L, "55", "101")).thenReturn(Optional.empty());
        when(messages.findMessage(21L, "55", "102")).thenReturn(Optional.empty());

        service.commitTrackingPage(claimed, List.of(snapshot("102"), snapshot("100"), snapshot("101")));

        assertThat(persisted.getLiveCursorMessageId()).isEqualTo("102");
        assertThat(persisted.getCursorMessageId()).isEqualTo("80");
        assertThat(persisted.getLiveScannedMessages()).isEqualTo(2);
        assertThat(persisted.getCollectedMessages()).isEqualTo(2);
        assertThat(persisted.getLiveCheckedAt()).isNotNull();
        assertThat(persisted.getLiveStatusMessage()).contains("不是 Telegram 推送");
        var captor = org.mockito.ArgumentCaptor.forClass(TelegramCollectedMessage.class);
        verify(messages, org.mockito.Mockito.times(2)).save(captor.capture());
        assertThat(captor.getAllValues()).extracting(TelegramCollectedMessage::getTelegramMessageId)
                .containsExactly("101", "102");
    }

    @Test
    void staleCatchUpLeaseCannotSaveOrAdvanceEitherCursor()
    {
        prepareTrackingLease("100");
        claimed.setLiveLeaseOwner("old-worker");

        service.commitTrackingPage(claimed, List.of(snapshot("101")));

        assertThat(persisted.getLiveCursorMessageId()).isEqualTo("100");
        assertThat(persisted.getLiveScannedMessages()).isZero();
        verify(messages, never()).save(org.mockito.ArgumentMatchers.any(TelegramCollectedMessage.class));
    }

    private void prepareTrackingLease(String cursor)
    {
        persisted.setMessageLink(null);
        persisted.setChatId("55");
        persisted.setStatus("COMPLETED");
        persisted.setTrackingEnabled(true);
        persisted.setCursorMessageId("80");
        persisted.setLiveCursorMessageId(cursor);
        persisted.setLiveScannedMessages(0);
        persisted.setLiveLeaseOwner("live-lease-token");
        persisted.setLiveLeaseExpiresAt(com.mayday.common.util.BusinessTime.now().plusMinutes(1));
        claimed.setLiveLeaseOwner("live-lease-token");
        claimed.setLiveLeaseExpiresAt(persisted.getLiveLeaseExpiresAt());
        claimed.setTrackingEnabled(true);
        claimed.setLiveCursorMessageId(cursor);
        claimed.setChatId("55");
        claimed.setStatus("COMPLETED");
    }

    private TelegramMessageSnapshot snapshot(String messageId)
    {
        return new TelegramMessageSnapshot("55", messageId, null, false, "history", "TEXT", "message", "[]", "[]", null,
                1L, null, true, null, null, "[]");
    }

    private TelegramMessageSnapshot snapshotAt(String messageId, LocalDate date)
    {
        long timestamp = date.atTime(12, 0).atZone(ZoneId.of("Asia/Shanghai")).toEpochSecond();
        return new TelegramMessageSnapshot("55", messageId, null, false, "history", "TEXT", "message", "[]", "[]", null,
                timestamp, null, true, null, null, "[]");
    }
}
