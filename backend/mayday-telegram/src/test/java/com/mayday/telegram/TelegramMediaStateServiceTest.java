package com.mayday.telegram;

import java.time.LocalDateTime;
import java.util.Optional;

import com.mayday.common.util.BusinessTime;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Ensures an expired or replaced media worker cannot publish another worker's
 * object.
 */
class TelegramMediaStateServiceTest
{
    @Test
    void retentionClaimIsLeaseFencedAndClearsOnlyTheStoredObjectReference()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia row = new TelegramMedia();
        row.setId(9L);
        row.setStatus("AVAILABLE");
        row.setStorageProvider("LOCAL");
        row.setStorageKey("ab/object");
        row.setSha256("a".repeat(64));
        row.setActualSize(1234L);
        row.setStreamTicketHash("b".repeat(64));
        when(mapper.lockExpired(org.mockito.ArgumentMatchers.any(LocalDateTime.class))).thenReturn(row);
        when(mapper.lock(9L)).thenReturn(Optional.of(row));

        TelegramMedia claim = states.claimExpired(BusinessTime.now().minusDays(90));
        boolean completed = states.completeRetention(claim);

        assertThat(completed).isTrue();
        assertThat(row.getStatus()).isEqualTo("EXPIRED");
        assertThat(row.getStorageProvider()).isNull();
        assertThat(row.getStorageKey()).isNull();
        assertThat(row.getSha256()).isNull();
        assertThat(row.getActualSize()).isEqualTo(1234L);
        assertThat(row.getStreamTicketHash()).isNull();
        assertThat(row.getLeaseOwner()).isNull();
        verify(mapper, org.mockito.Mockito.times(2)).save(row);
    }

    @Test
    void staleCleanupWorkerCannotExpireAClaimOwnedByAnotherInstance()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia staleClaim = new TelegramMedia();
        staleClaim.setId(9L);
        staleClaim.setLeaseOwner("old-worker");
        TelegramMedia current = new TelegramMedia();
        current.setId(9L);
        current.setStatus("DELETING");
        current.setLeaseOwner("new-worker");
        current.setLeaseExpiresAt(BusinessTime.now().plusMinutes(5));
        when(mapper.lock(9L)).thenReturn(Optional.of(current));

        boolean completed = states.completeRetention(staleClaim);

        assertThat(completed).isFalse();
        assertThat(current.getStatus()).isEqualTo("DELETING");
        verify(mapper, never()).save(current);
    }

    @Test
    void publishesFileOnlyWhileTheCurrentWorkerOwnsTheUnexpiredLease()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia claim = activeClaim();
        when(tasks.findById(7L)).thenReturn(Optional.of(activeTask()));
        when(mapper.lock(1L)).thenReturn(Optional.of(claim));

        boolean published = states.publish(claim, "ab/00000000-0000-0000-0000-000000000000", "LOCAL", 16, "image/png",
                "a".repeat(64));

        assertThat(published).isTrue();
        assertThat(claim.getStatus()).isEqualTo("AVAILABLE");
        assertThat(claim.getStorageProvider()).isEqualTo("LOCAL");
        assertThat(claim.getStorageKey()).startsWith("ab/");
        assertThat(claim.getSha256()).hasSize(64);
        assertThat(claim.getLeaseOwner()).isNull();
        verify(mapper).save(claim);
    }

    @Test
    void staleWorkerCannotOverwriteAReclaimedMediaRow()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia staleClaim = activeClaim();
        TelegramMedia current = activeClaim();
        current.setLeaseOwner("newer-worker");
        when(mapper.lock(1L)).thenReturn(Optional.of(current));

        boolean published = states.publish(staleClaim, "ab/00000000-0000-0000-0000-000000000000", "LOCAL", 16,
                "image/png", "b".repeat(64));

        assertThat(published).isFalse();
        verify(mapper, never()).save(current);
    }

    @Test
    void cancelledParentTaskPreventsPublishingAndReleasesTheMediaLease()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia claim = activeClaim();
        TelegramCollectionTask cancelledTask = activeTask();
        cancelledTask.setStatus("CANCELLED");
        when(mapper.lock(1L)).thenReturn(Optional.of(claim));
        when(tasks.findById(7L)).thenReturn(Optional.of(cancelledTask));

        boolean published = states.publish(claim, "ab/00000000-0000-0000-0000-000000000000", "LOCAL", 16, "image/png",
                "c".repeat(64));

        assertThat(published).isFalse();
        assertThat(claim.getStatus()).isEqualTo("FAILED");
        assertThat(claim.getFailureMessage()).isEqualTo("来源采集任务已取消");
        assertThat(claim.getLeaseOwner()).isNull();
        verify(mapper).save(claim);
    }

    @Test
    void reconnectDoesNotRequeueMediaForCancelledTask()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramMediaStateService states = new TelegramMediaStateService(mapper, tasks);
        TelegramMedia claim = activeClaim();
        TelegramCollectionTask cancelledTask = activeTask();
        cancelledTask.setStatus("CANCELLED");
        when(mapper.lock(1L)).thenReturn(Optional.of(claim));
        when(tasks.findById(7L)).thenReturn(Optional.of(cancelledTask));

        states.releaseForReconnect(claim);

        assertThat(claim.getStatus()).isEqualTo("FAILED");
        assertThat(claim.getLeaseOwner()).isNull();
        verify(mapper).save(claim);
    }

    private TelegramMedia activeClaim()
    {
        TelegramMedia row = new TelegramMedia();
        row.setId(1L);
        row.setTaskId(7L);
        row.setStatus("DOWNLOADING");
        row.setLeaseOwner("worker-one");
        row.setLeaseExpiresAt(BusinessTime.now().plusMinutes(5));
        row.setAttemptCount(1);
        return row;
    }

    private TelegramCollectionTask activeTask()
    {
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(7L);
        task.setStatus("COMPLETED");
        return task;
    }
}
