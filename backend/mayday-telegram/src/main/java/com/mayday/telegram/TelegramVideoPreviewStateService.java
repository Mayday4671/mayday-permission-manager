package com.mayday.telegram;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.mayday.common.util.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transaction boundary for preview queue state. Long-running media/process I/O
 * stays in the coordinator service; only row locks and bounded DB transitions
 * are handled here.
 */
@Service
@RequiredArgsConstructor
class TelegramVideoPreviewStateService
{
    private static final Duration CLEANUP_LEASE = Duration.ofMinutes(10);

    private final AccessPolicy access;
    private final UserMapper users;
    private final TelegramMediaMapper media;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final TelegramVideoPreviewMapper previews;
    private final TelegramVideoPreviewAssetMapper assets;

    /** 在行锁下核对租约、所有者和来源策略，再一次性发布完整 HLS 资产集合。 */
    @Transactional
    boolean publish(TelegramVideoPreview claim, TelegramVideoPreviewProcessor.ProbeResult probe,
            List<TelegramVideoPreviewAsset> publishedAssets)
    {
        TelegramVideoPreview current = previews.lockByMediaId(claim.getMediaId()).orElse(null);
        if (!ownsLease(current, claim) || !"PROCESSING".equals(current.getStatus()))
        {
            return false;
        }
        TelegramMedia source = media.findById(claim.getMediaId()).orElse(null);
        SysUser owner = users.findById(claim.getOwnerId()).orElse(null);
        if (!eligible(owner, current) || !sourceValid(current, source))
        {
            return false;
        }
        for (TelegramVideoPreviewAsset asset : publishedAssets)
        {
            assets.save(asset);
        }
        current.setStatus("READY");
        current.setDurationSeconds(probe.durationSeconds());
        current.setVideoCodec(probe.videoCodec());
        current.setAudioCodec(probe.audioCodec());
        current.setTranscoded(
                !"h264".equals(probe.videoCodec()) || !"yuv420p".equals(probe.pixelFormat()) || probe.width() > 1280
                        || probe.height() > 720 || (probe.audioCodec() != null && !"aac".equals(probe.audioCodec())));
        current.setReservedBytes(0L);
        current.setFailureMessage(null);
        clearLease(current);
        previews.save(current);
        return true;
    }

    /** 仅由仍持有本次租约的工作器写入安全错误状态，过期工作器不能覆写新结果。 */
    @Transactional
    void fail(TelegramVideoPreview claim, String failureMessage)
    {
        previews.lockByMediaId(claim.getMediaId())
                .filter(current -> ownsLease(current, claim) && "PROCESSING".equals(current.getStatus()))
                .ifPresent(current -> {
                    current.setStatus("FAILED");
                    current.setReservedBytes(0L);
                    current.setFailureMessage(safeMessage(failureMessage));
                    clearLease(current);
                    previews.save(current);
                });
    }

    /** 抢占源附件已经按留存周期过期的预览清理任务。 */
    @Transactional
    TelegramVideoPreview claimExpired()
    {
        TelegramVideoPreview row = previews.lockExpired();
        if (row == null)
        {
            return null;
        }
        row.setStatus("DELETING");
        row.setReservedBytes(0L);
        row.setLeaseOwner(UUID.randomUUID().toString());
        row.setLeaseExpiresAt(BusinessTime.now().plus(CLEANUP_LEASE));
        previews.save(row);
        return row;
    }

    /** 在存储对象删除成功后删除元数据，并保留 EXPIRED 状态作为历史审计痕迹。 */
    @Transactional
    void completeExpiredCleanup(TelegramVideoPreview claim)
    {
        TelegramVideoPreview current = previews.lockByMediaId(claim.getMediaId()).orElse(null);
        if (!ownsLease(current, claim) || !"DELETING".equals(current.getStatus()))
        {
            return;
        }
        for (TelegramVideoPreviewAsset asset : assets.lockForPreview(current.getId()))
        {
            assets.delete(asset);
        }
        current.setStatus("EXPIRED");
        current.setFailureMessage(null);
        current.setDurationSeconds(null);
        current.setVideoCodec(null);
        current.setAudioCodec(null);
        current.setTranscoded(null);
        clearLease(current);
        previews.save(current);
    }

    private boolean eligible(SysUser owner, TelegramVideoPreview task)
    {
        return owner != null && access.hasFor(owner, "telegram:view") && access.hasFor(owner, "telegram:download")
                && access.containsFor(owner, "telegram", task.getOwnerId(), task.getDepartmentId());
    }

    private boolean sourceValid(TelegramVideoPreview preview, TelegramMedia source)
    {
        if (source == null || !Objects.equals(preview.getMediaId(), source.getId())
                || !Objects.equals(preview.getOwnerId(), source.getOwnerId())
                || !Objects.equals(preview.getDepartmentId(), source.getDepartmentId())
                || !"AVAILABLE".equals(source.getStatus()) || source.getStorageKey() == null
                || source.getStorageProvider() == null || !TelegramVideoMediaPolicy.isPreviewCandidate(source))
        {
            return false;
        }
        TelegramCollectionTask task = tasks.findById(source.getTaskId()).orElse(null);
        TelegramCollectedMessage message = messages.findById(source.getMessageId()).orElse(null);
        return task != null && message != null && TelegramVideoMediaPolicy.isDownloadAllowed(source, task)
                && Boolean.TRUE.equals(message.getCanBeSaved()) && !"CANCELLED".equals(task.getStatus())
                && Objects.equals(task.getOwnerId(), source.getOwnerId())
                && Objects.equals(message.getOwnerId(), source.getOwnerId())
                && Objects.equals(task.getDepartmentId(), source.getDepartmentId())
                && Objects.equals(message.getDepartmentId(), source.getDepartmentId())
                && Objects.equals(message.getTaskId(), source.getTaskId());
    }

    private boolean ownsLease(TelegramVideoPreview current, TelegramVideoPreview claim)
    {
        return current != null && Objects.equals(current.getId(), claim.getId())
                && Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner()) && current.getLeaseExpiresAt() != null
                && current.getLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    private String safeMessage(String message)
    {
        if (message == null || message.isBlank())
        {
            return "视频预览处理失败；可检查配置后重试";
        }
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private void clearLease(TelegramVideoPreview row)
    {
        row.setLeaseOwner(null);
        row.setLeaseExpiresAt(null);
    }
}
