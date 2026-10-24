package com.mayday.telegram;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.BusinessTime;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 清理一个已停止的采集任务及其媒体、HLS 资产。先提交不可读状态，再删除存储对象，最后删除关系记录；
 * 存储失败或进程退出时保留对象引用，重试不会把已经删除的文件重新暴露为可用附件。
 */
@Service
@RequiredArgsConstructor
class TelegramCollectionCleanupService
{
    private static final Duration CLEANUP_LEASE = Duration.ofMinutes(10);
    private static final String LEASE_PREFIX = "del:";

    private final TelegramModuleGuard moduleGuard;
    private final AccessPolicy access;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final TelegramMediaMapper media;
    private final TelegramVideoPreviewMapper previews;
    private final TelegramVideoPreviewAssetMapper assets;
    private final StoredFileContent storedFiles;
    private final TransactionTemplate transactions;

    /** 独立提交清理意图，避免对象删除失败后数据库回滚成 AVAILABLE/READY。 */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void delete(Long taskId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:delete");
        CleanupClaim claim = Objects.requireNonNull(transactions.execute(status -> claim(taskId)));
        try
        {
            // 先删衍生资源，保证原附件删除前已经处理所有 HLS 引用。
            for (StoredObject object : claim.objects())
            {
                storedFiles.storage(object.provider()).delete(object.key());
            }
            transactions.executeWithoutResult(status -> complete(claim));
        } catch (IOException | RuntimeException exception)
        {
            transactions.executeWithoutResult(status -> release(claim));
            throw new BusinessException("采集文件清理未完成，记录已保留且停止访问；请检查存储服务后重试删除");
        }
    }

    /** 锁定任务和全部附件，再撤销工作器租约；已取消的转码工作器不能继续发布资产。 */
    private CleanupClaim claim(Long taskId)
    {
        TelegramCollectionTask task = tasks.lock(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 采集任务不存在"));
        access.checkData("telegram", task.getOwnerId(), task.getDepartmentId());
        if (!List.of("COMPLETED", "FAILED", "CANCELLED").contains(task.getStatus()))
        {
            throw new BusinessException("请先取消或等待任务结束，再清理采集记录");
        }
        if (isCleanupLease(task.getLeaseOwner()) && activeLease(task.getLeaseExpiresAt()))
        {
            throw new BusinessException("采集记录正在清理，请稍后刷新");
        }
        List<TelegramMedia> attachments = media.lockForTask(taskId);
        List<TelegramVideoPreview> previewRows = new ArrayList<>();
        List<StoredObject> objects = new ArrayList<>();
        for (TelegramMedia attachment : attachments)
        {
            if (!Objects.equals(task.getOwnerId(), attachment.getOwnerId())
                    || !Objects.equals(task.getDepartmentId(), attachment.getDepartmentId())
                    || !Objects.equals(taskId, attachment.getTaskId()))
            {
                throw new BusinessException("附件归属与采集任务不一致，不能清理");
            }
            if (List.of("QUEUED", "DOWNLOADING").contains(attachment.getStatus())
                    || "DELETING".equals(attachment.getStatus()) && !isCleanupLease(attachment.getLeaseOwner())
                            && activeLease(attachment.getLeaseExpiresAt()))
            {
                throw new BusinessException("附件下载或清理仍在处理中，请等待完成后再删除任务");
            }
            previews.lockByMediaId(attachment.getId()).ifPresent(preview -> {
                if (!Objects.equals(preview.getOwnerId(), task.getOwnerId())
                        || !Objects.equals(preview.getDepartmentId(), task.getDepartmentId()))
                {
                    throw new BusinessException("视频预览归属与采集任务不一致，不能清理");
                }
                if ("DELETING".equals(preview.getStatus()) && !isCleanupLease(preview.getLeaseOwner())
                        && activeLease(preview.getLeaseExpiresAt()))
                {
                    throw new BusinessException("视频预览清理仍在处理中，请稍后重试");
                }
                previewRows.add(preview);
                for (TelegramVideoPreviewAsset asset : assets.lockForPreview(preview.getId()))
                {
                    addObject(objects, asset.getStorageProvider(), asset.getStorageKey());
                }
            });
        }
        for (TelegramMedia attachment : attachments)
        {
            addObject(objects, attachment.getStorageProvider(), attachment.getStorageKey());
        }

        // 三张表的 lease_owner 都是 VARCHAR(36)；前缀与无连字符 UUID 必须共同保持该长度。
        String lease = LEASE_PREFIX + UUID.randomUUID().toString().replace("-", "");
        var expiresAt = BusinessTime.now().plus(CLEANUP_LEASE);
        task.setStatus("CANCELLED");
        task.setStatusMessage("正在清理采集记录和附件；失败后可再次删除");
        task.setTrackingEnabled(false);
        task.setLiveLeaseOwner(null);
        task.setLiveLeaseExpiresAt(null);
        task.setLeaseOwner(lease);
        task.setLeaseExpiresAt(expiresAt);
        tasks.save(task);
        for (TelegramVideoPreview preview : previewRows)
        {
            preview.setStatus("DELETING");
            preview.setReservedBytes(0L);
            preview.setLeaseOwner(lease);
            preview.setLeaseExpiresAt(expiresAt);
            previews.save(preview);
        }
        for (TelegramMedia attachment : attachments)
        {
            attachment.setStatus("DELETING");
            attachment.setLeaseOwner(lease);
            attachment.setLeaseExpiresAt(expiresAt);
            attachment.setStreamTicketHash(null);
            attachment.setStreamTicketExpiresAt(null);
            media.save(attachment);
        }
        return new CleanupClaim(taskId, lease, List.copyOf(objects));
    }

    /** 按外键依赖顺序删除；任何租约被替换时旧请求都不能删除新工作器的数据。 */
    private void complete(CleanupClaim claim)
    {
        TelegramCollectionTask task = tasks.lock(claim.taskId()).orElse(null);
        if (task == null || !Objects.equals(claim.lease(), task.getLeaseOwner()))
        {
            throw new BusinessException("清理租约已改变，请刷新后重试");
        }
        List<TelegramMedia> attachments = media.lockForTask(task.getId());
        List<TelegramVideoPreview> previewRows = new ArrayList<>();
        for (TelegramMedia attachment : attachments)
        {
            if (!Objects.equals(claim.lease(), attachment.getLeaseOwner()))
            {
                throw new BusinessException("附件清理租约已改变，请刷新后重试");
            }
            previews.lockByMediaId(attachment.getId()).ifPresent(preview -> {
                if (!Objects.equals(claim.lease(), preview.getLeaseOwner()))
                {
                    throw new BusinessException("视频预览清理租约已改变，请刷新后重试");
                }
                previewRows.add(preview);
            });
        }
        for (TelegramVideoPreview preview : previewRows)
        {
            assets.deleteByQuery(QueryWrapper.create().where(new QueryColumn("preview_id").eq(preview.getId())));
            previews.deleteById(preview.getId());
        }
        media.deleteByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(task.getId()))
                .and(new QueryColumn("owner_id").eq(task.getOwnerId())));
        messages.deleteByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(task.getId()))
                .and(new QueryColumn("owner_id").eq(task.getOwnerId())));
        tasks.deleteById(task.getId());
    }

    /** 失败后立即允许重试，但不恢复附件可读状态，防止呈现已被部分删除的文件。 */
    private void release(CleanupClaim claim)
    {
        tasks.lock(claim.taskId()).filter(task -> Objects.equals(claim.lease(), task.getLeaseOwner()))
                .ifPresent(task -> {
                    var expiredAt = BusinessTime.now().minusSeconds(1);
                    task.setLeaseExpiresAt(expiredAt);
                    task.setStatusMessage("文件清理未完成，请重试删除；已清理的附件不再提供访问");
                    tasks.save(task);
                    for (TelegramMedia attachment : media.lockForTask(task.getId()))
                    {
                        if (Objects.equals(claim.lease(), attachment.getLeaseOwner()))
                        {
                            attachment.setLeaseExpiresAt(expiredAt);
                            media.save(attachment);
                        }
                        previews.lockByMediaId(attachment.getId())
                                .filter(preview -> Objects.equals(claim.lease(), preview.getLeaseOwner()))
                                .ifPresent(preview -> {
                                    preview.setLeaseExpiresAt(expiredAt);
                                    previews.save(preview);
                                });
                    }
                });
    }

    private boolean isCleanupLease(String lease)
    {
        return lease != null && lease.startsWith(LEASE_PREFIX);
    }

    private boolean activeLease(java.time.LocalDateTime expiresAt)
    {
        return expiresAt != null && expiresAt.isAfter(BusinessTime.now());
    }

    private void addObject(List<StoredObject> objects, String provider, String key)
    {
        if (provider != null && key != null)
        {
            objects.add(new StoredObject(provider, key));
        }
    }

    /** 保存已锁定资产的存储定位信息，供事务提交后的文件清理使用。 */
    private record StoredObject(String provider, String key) {
    }

    /** 传递同一次清理已提交的租约和资产快照，防止旧请求删除被新工作器接管的数据。 */
    private record CleanupClaim(Long taskId, String lease, List<StoredObject> objects) {
    }
}
