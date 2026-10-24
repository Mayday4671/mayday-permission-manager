package com.mayday.telegram;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;

import com.mayday.common.util.BusinessTime;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies lease-fenced media state transitions in short database transactions.
 */
@Service
@RequiredArgsConstructor
public class TelegramMediaStateService
{
    private static final java.time.Duration CLEANUP_LEASE = java.time.Duration.ofMinutes(10);

    private final TelegramMediaMapper media;
    private final TelegramCollectionTaskMapper tasks;

    /**
     * Renews a live attempt without letting an expired or replaced worker regain
     * ownership.
     */
    @Transactional
    public boolean renew(TelegramMedia claim)
    {
        TelegramMedia current = media.lock(claim.getId()).orElse(null);
        if (!ownsLease(current, claim) || cancelled(current))
        {
            return false;
        }
        current.setLeaseExpiresAt(BusinessTime.now().plusMinutes(10));
        media.save(current);
        return true;
    }

    /**
     * Publishes a stored object only while the same live worker still owns the row.
     */
    @Transactional
    public boolean publish(TelegramMedia claim, String key, String provider, long size, String type, String digest)
    {
        TelegramMedia current = media.lock(claim.getId()).orElse(null);
        if (!ownsLease(current, claim))
        {
            return false;
        }
        if (cancelled(current))
        {
            failCancelled(current);
            return false;
        }
        current.setStatus("AVAILABLE");
        current.setStorageKey(key);
        current.setStorageProvider(provider);
        current.setActualSize(size);
        current.setMediaType(type);
        current.setSha256(digest);
        current.setFailureMessage(null);
        clearLease(current);
        media.save(current);
        return true;
    }

    /**
     * Stores a safe failure reason only if the original worker still owns the
     * lease.
     */
    @Transactional
    public void fail(TelegramMedia claim, String reason)
    {
        media.lock(claim.getId()).filter(current -> ownsLease(current, claim)).ifPresent(current -> {
            current.setStatus("FAILED");
            current.setFailureMessage(reason);
            clearLease(current);
            media.save(current);
        });
    }

    /** Returns the lease to the queue when Telegram is temporarily disconnected. */
    @Transactional
    public void releaseForReconnect(TelegramMedia claim)
    {
        media.lock(claim.getId()).filter(current -> ownsLease(current, claim)).ifPresent(current -> {
            if (cancelled(current))
            {
                failCancelled(current);
            } else
            {
                current.setStatus("QUEUED");
                current.setAttemptCount(
                        Math.max(0, (current.getAttemptCount() == null ? 1 : current.getAttemptCount()) - 1));
                current.setFailureMessage("等待 Telegram 账号重新连接");
                clearLease(current);
                media.save(current);
            }
        });
    }

    /** Returns a claim to the queue when a bounded executor cannot accept work. */
    @Transactional
    public void releaseForQueue(TelegramMedia claim)
    {
        media.lock(claim.getId()).filter(current -> ownsLease(current, claim)).ifPresent(current -> {
            current.setStatus("QUEUED");
            current.setAttemptCount(
                    Math.max(0, (current.getAttemptCount() == null ? 1 : current.getAttemptCount()) - 1));
            current.setFailureMessage("等待媒体处理线程空闲");
            clearLease(current);
            media.save(current);
        });
    }

    /** Claims one expired media object while holding only a short database lock. */
    @Transactional
    public TelegramMedia claimExpired(LocalDateTime expiredBefore)
    {
        TelegramMedia row = media.lockExpired(expiredBefore);
        if (row == null)
        {
            return null;
        }
        row.setStatus("DELETING");
        row.setLeaseOwner(UUID.randomUUID().toString());
        row.setLeaseExpiresAt(BusinessTime.now().plus(CLEANUP_LEASE));
        row.setFailureMessage(null);
        media.save(row);
        return row;
    }

    /**
     * Marks a lease-owned row as cleaned only after its storage deletion succeeds.
     */
    @Transactional
    public boolean completeRetention(TelegramMedia claim)
    {
        TelegramMedia current = media.lock(claim.getId()).orElse(null);
        if (!ownsCleanupLease(current, claim))
        {
            return false;
        }
        current.setStatus("EXPIRED");
        current.setStorageKey(null);
        current.setStorageProvider(null);
        current.setSha256(null);
        current.setStreamTicketHash(null);
        current.setStreamTicketExpiresAt(null);
        current.setDownloadTicketHash(null);
        current.setDownloadTicketExpiresAt(null);
        current.setFailureMessage(null);
        clearLease(current);
        media.save(current);
        return true;
    }

    private boolean cancelled(TelegramMedia attachment)
    {
        return tasks.findById(attachment.getTaskId()).map(task -> "CANCELLED".equals(task.getStatus())).orElse(true);
    }

    private void failCancelled(TelegramMedia attachment)
    {
        attachment.setStatus("FAILED");
        attachment.setFailureMessage("来源采集任务已取消");
        clearLease(attachment);
        media.save(attachment);
    }

    private boolean ownsLease(TelegramMedia current, TelegramMedia claim)
    {
        return current != null && "DOWNLOADING".equals(current.getStatus())
                && Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner()) && current.getLeaseExpiresAt() != null
                && current.getLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    private boolean ownsCleanupLease(TelegramMedia current, TelegramMedia claim)
    {
        return current != null && "DELETING".equals(current.getStatus())
                && Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner()) && current.getLeaseExpiresAt() != null
                && current.getLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    private void clearLease(TelegramMedia row)
    {
        row.setLeaseOwner(null);
        row.setLeaseExpiresAt(null);
    }
}
