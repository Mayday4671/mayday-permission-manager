package com.mayday.telegram;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.persistence.PageResult;
import com.mayday.common.util.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.TelegramCollectionContracts.CollectedMessageView;
import com.mayday.telegram.TelegramCollectionContracts.TaskView;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the user-authorized, bounded Telegram history task lifecycle.
 *
 * <p>
 * TDLib reads run outside database transactions. Each page and its cursor are
 * committed together, and a lease token prevents a stale worker from writing
 * after another worker has reclaimed a task.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TelegramCollectionService
{
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_SCANNED_MESSAGES = 5_000;
    private static final int MAX_TRACKED_MESSAGES = 10_000;
    private static final int TASK_LEASE_SECONDS = 60;
    private final TelegramModuleGuard moduleGuard;
    private final AccessPolicy access;
    private final UserMapper users;
    private final TelegramSessionCoordinator sessions;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final TelegramMediaQueueService mediaQueue;
    private final com.mayday.telegram.mapper.TelegramMediaMapper media;
    private final TelegramCollectionCleanupService cleanup;

    /** Persists an explicit collection request without contacting Telegram. */
    @Transactional
    public TaskView create(TelegramCollectionRequest request)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:collect");
        access.require("telegram:view");
        boolean hasLink = request.messageLink() != null && !request.messageLink().isBlank();
        boolean hasChannel = request.channelId() != null && !request.channelId().isBlank();
        if (hasLink == hasChannel)
        {
            throw new BusinessException("请选择一个 Telegram 消息链接或已加入的频道作为采集来源");
        }
        if (request.includeAlbum() && (!hasLink || request.fromDate() != null || request.toDate() != null
                || request.maxMessages() > TelegramMessageAlbumReader.MAX_ALBUM_MESSAGES))
        {
            throw new BusinessException("相册预览仅支持消息链接，不支持日期筛选，且单次最多 10 条同组消息");
        }
        if (request.fromDate() != null && request.toDate() != null && request.fromDate().isAfter(request.toDate()))
        {
            throw new BusinessException("开始日期不能晚于结束日期");
        }
        LocalDate oldestAllowedDate = request.fromDate() == null ? request.toDate() : request.fromDate();
        LocalDate today = LocalDate.now(BusinessTime.zone());
        if (oldestAllowedDate != null && oldestAllowedDate.isBefore(today.minusYears(10)))
        {
            throw new BusinessException("采集日期范围不能早于近十年，避免产生无界历史扫描");
        }
        if (request.toDate() != null && request.toDate().isAfter(today))
        {
            throw new BusinessException("结束日期不能晚于今天");
        }
        String link = null;
        TelegramChannelOption channel = null;
        if (hasLink)
        {
            try
            {
                link = TelegramMessageLinkValidator.validate(request.messageLink());
            } catch (IllegalArgumentException exception)
            {
                throw new BusinessException(exception.getMessage());
            }
        } else
        {
            TelegramSessionClient client = sessions.requireReadyClient("telegram:collect");
            try
            {
                channel = client.resolveChannel(request.channelId().trim()).join();
            } catch (java.util.concurrent.CompletionException | IllegalArgumentException exception)
            {
                throw new BusinessException("所选频道当前不可访问；请刷新频道列表后重试");
            }
        }
        if (request.maxMessages() < 1 || request.maxMessages() > 500)
        {
            throw new IllegalArgumentException("单次最多采集 500 条消息");
        }
        if (request.downloadImages() || request.downloadVideos() || request.downloadDocuments())
        {
            access.require("telegram:download");
        }
        SysUser owner = access.current();
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setOwnerId(owner.getId());
        task.setDepartmentId(owner.getDepartmentId());
        task.setMessageLink(link);
        task.setIncludeAlbum(request.includeAlbum());
        task.setSourceTitle(channel == null ? null : channel.title());
        task.setFromDate(request.fromDate());
        task.setToDate(request.toDate());
        if (channel != null)
        {
            task.setChatId(channel.chatId());
            task.setCursorMessageId("0");
        }
        task.setMaxMessages(request.maxMessages());
        task.setCollectedMessages(0);
        task.setScannedMessages(0);
        task.setLiveScannedMessages(0);
        task.setTrackingEnabled(false);
        task.setDownloadImages(request.downloadImages());
        task.setDownloadVideos(request.downloadVideos());
        task.setDownloadDocuments(request.downloadDocuments());
        task.setStatus("QUEUED");
        task.setStatusMessage("采集请求已排队；读取消息需要当前 Telegram 账号仍可访问所选来源");
        tasks.save(task);
        return taskView(task);
    }

    /**
     * Searches the authorized account's known chats and returns only verified
     * channels.
     */
    public List<TelegramChannelOption> searchChannels(String query, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:collect");
        access.require("telegram:view");
        int limit = Math.max(1, Math.min(size, 50));
        if (query == null || query.trim().length() < 2 || query.trim().length() > 100)
        {
            throw new BusinessException("频道搜索词需为 2 至 100 个字符");
        }
        try
        {
            return sessions.requireReadyClient("telegram:collect").searchChannels(query.trim(), limit).join();
        } catch (java.util.concurrent.CompletionException exception)
        {
            throw new BusinessException("频道搜索失败；请确认 Telegram 账号已连接后重试");
        }
    }

    /** Lists tasks in SQL-enforced data scope. */
    public PageResult<TaskView> list(int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        QueryWrapper filter = access.filter("telegram", "owner_id");
        return PageResult.of(tasks.paginate(PageResult.request(page, Math.min(size, 100)),
                filter.orderBy(new QueryColumn("id").desc())), this::taskView);
    }

    /** Returns current task progress only after enforcing its owner data scope. */
    public TaskView detail(Long taskId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        return taskView(visibleTask(taskId));
    }

    /** Reads only messages belonging to one task visible to the current user. */
    public PageResult<CollectedMessageView> listMessages(Long taskId, int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramCollectionTask task = visibleTask(taskId);
        QueryWrapper filter = access.filter("telegram", "owner_id").and(new QueryColumn("task_id").eq(task.getId()));
        var result = messages.paginate(PageResult.request(page, Math.min(size, 100)),
                filter.orderBy(new QueryColumn("telegram_sent_at").desc(), new QueryColumn("id").desc()));
        boolean canDownload = access.has("telegram:download");
        return PageResult.from(
                result.map(item -> CollectedMessageView.from(item, media.findForMessage(item.getId()), canDownload)));
    }

    /**
     * Enables or stops bounded periodic polling for a completed channel task. Link
     * tasks and date-bounded tasks cannot silently expand their source range.
     */
    @Transactional
    public TaskView setTracking(Long taskId, boolean enabled)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:collect");
        access.require("telegram:view");
        TelegramCollectionTask task = tasks.lock(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 采集任务不存在"));
        access.checkData("telegram", task.getOwnerId(), task.getDepartmentId());
        if (!"COMPLETED".equals(task.getStatus()))
        {
            throw new BusinessException("定期追赶只能用于已完成的历史采集任务");
        }
        if (task.getMessageLink() != null || task.getChatId() == null)
        {
            throw new BusinessException("消息链接任务不能启用频道定期追赶");
        }
        if (enabled && task.getToDate() != null)
        {
            throw new BusinessException("设置了结束日期的历史范围不能扩展；请创建未设置结束日期的频道任务");
        }
        if (enabled && java.util.Objects.requireNonNullElse(task.getLiveScannedMessages(), 0) >= MAX_TRACKED_MESSAGES)
        {
            throw new BusinessException("该任务已达到定期追赶的 10,000 条硬上限，请新建采集任务");
        }
        if (enabled)
        {
            if (task.getLiveCursorMessageId() == null)
            {
                long newestSavedId = messages.newestMessageId(task.getId(), task.getChatId());
                task.setLiveCursorMessageId(Long.toString(newestSavedId));
            }
            task.setTrackingEnabled(true);
            task.setLiveStatusMessage("定期拉取已开启：约每 30 秒检查一次，不会自动加入频道；历史回填游标保持独立");
        } else
        {
            task.setTrackingEnabled(false);
            clearTrackingLease(task);
            task.setLiveStatusMessage("定期拉取已停止；已保存的消息和历史回填游标保留");
        }
        tasks.save(task);
        return taskView(task);
    }

    /**
     * Pauses future pages; any in-flight read is discarded unless it still owns the
     * lease.
     */
    @Transactional
    public TaskView pause(Long taskId)
    {
        TelegramCollectionTask task = mutableTask(taskId);
        if (!List.of("QUEUED", "RUNNING", "WAITING_ACCOUNT").contains(task.getStatus()))
        {
            throw new BusinessException("当前采集任务状态不能暂停");
        }
        task.setStatus("PAUSED");
        task.setLeaseOwner(null);
        task.setLeaseExpiresAt(null);
        task.setStatusMessage("任务已暂停；已保存的消息与进度会保留");
        tasks.save(task);
        return taskView(task);
    }

    /** Resumes a persisted task from the last committed message cursor. */
    @Transactional
    public TaskView resume(Long taskId)
    {
        TelegramCollectionTask task = mutableTask(taskId);
        if (!"PAUSED".equals(task.getStatus()))
        {
            throw new BusinessException("只有已暂停的采集任务可以继续");
        }
        task.setStatus("QUEUED");
        task.setStatusMessage("任务已恢复，等待采集线程继续处理");
        tasks.save(task);
        return taskView(task);
    }

    /**
     * Cancels remaining history reads without attempting to modify Telegram data.
     */
    @Transactional
    public TaskView cancel(Long taskId)
    {
        TelegramCollectionTask task = mutableTask(taskId);
        if ("CANCELLED".equals(task.getStatus())
                || List.of("COMPLETED", "FAILED").contains(task.getStatus()) && media.pendingCountForTask(taskId) == 0)
        {
            throw new BusinessException("任务已经结束");
        }
        task.setStatus("CANCELLED");
        task.setLeaseOwner(null);
        task.setLeaseExpiresAt(null);
        task.setTrackingEnabled(false);
        task.setLiveLeaseOwner(null);
        task.setLiveLeaseExpiresAt(null);
        task.setStatusMessage("任务和剩余附件下载已取消；已经保存的消息和文件保留");
        tasks.save(task);
        media.cancelQueuedForTask(task.getId());
        return taskView(task);
    }

    /**
     * Permanently removes a stopped task and its saved message snapshots. Active
     * tasks must be cancelled first so a worker cannot recreate deleted rows after
     * the cleanup transaction commits.
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public void delete(Long taskId)
    {
        cleanup.delete(taskId);
    }

    /** Claims the oldest eligible task with a short database row lock and lease. */
    @Transactional
    public TelegramCollectionTask claimNext()
    {
        moduleGuard.requireEnabled();
        LocalDateTime now = BusinessTime.now();
        QueryWrapper query = QueryWrapper.create()
                .where(new QueryColumn("status").in("QUEUED", "WAITING_ACCOUNT", "RUNNING"))
                .and(new com.mybatisflex.core.query.RawQueryCondition(
                        "lease_expires_at is null or lease_expires_at <= ?", now))
                .orderBy(new QueryColumn("created_at").asc(), new QueryColumn("id").asc()).forUpdate();
        TelegramCollectionTask task = tasks.selectOneByQuery(query);
        if (task == null)
        {
            return null;
        }
        task.setLeaseOwner(UUID.randomUUID().toString());
        task.setLeaseExpiresAt(now.plusSeconds(TASK_LEASE_SECONDS));
        task.setStatus("RUNNING");
        task.setStatusMessage("正在解析消息来源并读取有界历史");
        tasks.save(task);
        return task;
    }

    /**
     * Claims one due periodic channel check using an independent persisted lease.
     */
    @Transactional
    public TelegramCollectionTask claimNextTracking()
    {
        moduleGuard.requireEnabled();
        TelegramCollectionTask task = tasks.lockNextTracking();
        if (task == null)
        {
            return null;
        }
        SysUser owner = users.findById(task.getOwnerId()).orElse(null);
        if (!hasTrackingAccess(owner, task))
        {
            stopTracking(task, "定期拉取已停止：任务所有者已停用、失去权限或超出数据范围");
            return null;
        }
        LocalDateTime now = BusinessTime.now();
        task.setLiveLeaseOwner(UUID.randomUUID().toString());
        task.setLiveLeaseExpiresAt(now.plusSeconds(TASK_LEASE_SECONDS));
        tasks.save(task);
        return task;
    }

    /** Performs one bounded Telegram read outside the database transaction. */
    public List<TelegramMessageSnapshot> readTrackingPage(TelegramCollectionTask task)
    {
        moduleGuard.requireEnabled();
        String cursor = task.getLiveCursorMessageId() == null ? "0" : task.getLiveCursorMessageId();
        return sessions.requireTaskClient(task.getOwnerId())
                .getNewerChatHistory(task.getChatId(), cursor, MAX_PAGE_SIZE).join();
    }

    /**
     * Commits one periodic page idempotently without changing the historical
     * backfill cursor. The independent scan limit prevents unbounded collection.
     */
    @Transactional
    public void commitTrackingPage(TelegramCollectionTask claimed, List<TelegramMessageSnapshot> snapshotPage)
    {
        moduleGuard.requireEnabled();
        TelegramCollectionTask task = tasks.lock(claimed.getId()).orElse(null);
        if (!sameTrackingLease(task, claimed))
        {
            return;
        }
        SysUser owner = users.findById(task.getOwnerId()).orElse(null);
        if (!hasTrackingAccess(owner, task))
        {
            stopTracking(task, "定期拉取已停止：任务所有者已停用、失去权限或超出数据范围");
            return;
        }

        String chatId = task.getChatId();
        long cursor = parseId(task.getLiveCursorMessageId() == null ? "0" : task.getLiveCursorMessageId());
        int scanned = java.util.Objects.requireNonNullElse(task.getLiveScannedMessages(), 0);
        int remaining = MAX_TRACKED_MESSAGES - scanned;
        int pageScanned = 0;
        int saved = task.getCollectedMessages();
        long nextCursor = cursor;
        List<TelegramMessageSnapshot> ordered = snapshotPage.stream()
                .filter(snapshot -> java.util.Objects.equals(chatId, snapshot.chatId()))
                .sorted(java.util.Comparator.comparingLong(snapshot -> parseId(snapshot.messageId()))).toList();

        // TDLib returns newest first. Ascending IDs advance through a backlog
        // without skipping the messages between the stored checkpoint and latest.
        for (TelegramMessageSnapshot snapshot : ordered)
        {
            long messageId = parseId(snapshot.messageId());
            if (messageId <= cursor)
            {
                refreshEditedMessage(task, snapshot);
                continue;
            }
            if (pageScanned >= remaining)
            {
                break;
            }
            pageScanned++;
            nextCursor = Math.max(nextCursor, messageId);
            if (messages.findMessage(task.getId(), chatId, snapshot.messageId()).isPresent())
            {
                continue;
            }
            TelegramCollectedMessage message = toCollectedMessage(task, snapshot);
            messages.save(message);
            mediaQueue.enqueue(task, message);
            saved++;
        }

        int totalScanned = scanned + pageScanned;
        task.setCollectedMessages(saved);
        task.setLiveScannedMessages(totalScanned);
        task.setLiveCursorMessageId(Long.toString(nextCursor));
        task.setLiveCheckedAt(BusinessTime.now());
        if (totalScanned >= MAX_TRACKED_MESSAGES)
        {
            task.setTrackingEnabled(false);
            task.setLiveStatusMessage("定期拉取已自动停止：已达到 10,000 条检查上限，请按需新建采集任务");
        } else if (pageScanned == 0)
        {
            task.setLiveStatusMessage("定期拉取模式；最近检查未发现新消息。此功能不是 Telegram 推送，不能保证即时或完整送达");
        } else
        {
            task.setLiveStatusMessage("定期拉取模式；已检查 " + totalScanned + " 条，约每 30 秒继续检查。此功能不是 Telegram 推送，不能保证即时或完整送达");
        }
        clearTrackingLease(task);
        tasks.save(task);
    }

    /** Releases a catch-up lease briefly when the authorized account is offline. */
    @Transactional
    public void waitForTrackingAccount(TelegramCollectionTask claimed)
    {
        tasks.lock(claimed.getId()).filter(task -> sameTrackingLease(task, claimed)).ifPresent(task -> {
            task.setLiveLeaseExpiresAt(BusinessTime.now().plusSeconds(10));
            task.setLiveStatusMessage("定期拉取等待 Telegram 账号连接；连接后将从独立追赶游标继续");
            tasks.save(task);
        });
    }

    /**
     * Stops faulty tracking with a safe status; raw Telegram exceptions are
     * omitted.
     */
    @Transactional
    public void failTracking(TelegramCollectionTask claimed, String safeMessage)
    {
        tasks.lock(claimed.getId()).filter(task -> sameTrackingLease(task, claimed))
                .ifPresent(task -> stopTracking(task, safeMessage));
    }

    /**
     * Performs only the network read for one claimed page, outside a transaction.
     */
    public List<TelegramMessageSnapshot> readNextPage(TelegramCollectionTask task)
    {
        moduleGuard.requireEnabled();
        TelegramSessionClient client = sessions.requireTaskClient(task.getOwnerId());
        if (task.getChatId() == null || Boolean.TRUE.equals(task.getIncludeAlbum()))
        {
            TelegramMessageLink link = client.resolveMessageLink(task.getMessageLink()).join();
            task.setChatId(link.chatId());
            task.setStartMessageId(link.messageId());
            task.setCursorMessageId(link.messageId());
            // Link lookup already returns the selected message. Commit it before
            // paging older history; a one-message preview must never depend on it.
            TelegramMessageSnapshot snapshot = link.message();
            if (snapshot == null || !link.chatId().equals(snapshot.chatId())
                    || !link.messageId().equals(snapshot.messageId()))
            {
                throw new IllegalArgumentException("Telegram 链接解析未返回匹配的原消息");
            }
            if (Boolean.TRUE.equals(task.getIncludeAlbum()))
            {
                return client.getMessageAlbum(snapshot).join();
            }
            return List.of(snapshot);
        }
        String cursor = task.getCursorMessageId() == null ? "0" : task.getCursorMessageId();
        int remaining = MAX_SCANNED_MESSAGES - java.util.Objects.requireNonNullElse(task.getScannedMessages(), 0);
        if (remaining <= 0)
        {
            return List.of();
        }
        return client.getChatHistory(task.getChatId(), cursor, Math.min(MAX_PAGE_SIZE, remaining)).join();
    }

    /**
     * Atomically stores one page with its cursor; stale, paused or revoked work
     * cannot commit.
     */
    @Transactional
    public void commitPage(TelegramCollectionTask claimed, List<TelegramMessageSnapshot> snapshotPage)
    {
        moduleGuard.requireEnabled();
        TelegramCollectionTask task = tasks.lock(claimed.getId()).orElse(null);
        if (!sameLease(task, claimed))
        {
            return;
        }
        SysUser owner = users.findById(task.getOwnerId()).orElse(null);
        if (owner == null || !access.hasFor(owner, "telegram:collect") || !access.hasFor(owner, "telegram:view")
                || !access.containsFor(owner, "telegram", task.getOwnerId(), task.getDepartmentId()))
        {
            task.setStatus("CANCELLED");
            task.setStatusMessage("任务所有者已停用或失去采集权限，后续采集已停止");
            clearLease(task);
            tasks.save(task);
            return;
        }
        String chatId = task.getChatId() == null ? claimed.getChatId() : task.getChatId();
        String startMessageId = task.getStartMessageId() == null
                ? claimed.getStartMessageId()
                : task.getStartMessageId();
        String persistedCursor = task.getCursorMessageId() == null
                ? claimed.getCursorMessageId()
                : task.getCursorMessageId();
        int saved = task.getCollectedMessages();
        int scanned = java.util.Objects.requireNonNullElse(task.getScannedMessages(), 0);
        int scannedOnPage = 0;
        boolean linkSource = task.getMessageLink() != null;
        boolean firstLinkPage = linkSource && saved == 0 && task.getStartMessageId() == null;
        boolean firstChannelPage = !linkSource && saved == 0 && "0".equals(persistedCursor);
        boolean albumPreview = Boolean.TRUE.equals(task.getIncludeAlbum());
        String nextCursor = firstChannelPage ? null : persistedCursor;
        long currentCursor = parseId(persistedCursor);
        if (firstLinkPage && (startMessageId == null || snapshotPage.stream().noneMatch(
                item -> java.util.Objects.equals(chatId, item.chatId()) && startMessageId.equals(item.messageId()))))
        {
            task.setStatus("FAILED");
            task.setStatusMessage("Telegram 未返回链接指定的消息，任务已停止以避免采集错误范围");
            clearLease(task);
            tasks.save(task);
            return;
        }
        List<TelegramMessageSnapshot> acceptedPage = snapshotPage;
        if (albumPreview)
        {
            TelegramMessageSnapshot anchor = snapshotPage.stream()
                    .filter(item -> java.util.Objects.equals(chatId, item.chatId())
                            && java.util.Objects.equals(startMessageId, item.messageId()))
                    .findFirst().orElse(null);
            if (anchor == null)
            {
                task.setStatus("FAILED");
                task.setStatusMessage("Telegram 相册缺少所选原消息，已停止采集");
                clearLease(task);
                tasks.save(task);
                return;
            }
            // Recheck the adapter result at the transaction boundary. Neither a
            // neighboring post nor a reused album ID from another chat may be saved.
            var album = new java.util.LinkedHashMap<String, TelegramMessageSnapshot>();
            album.put(anchor.messageId(), anchor);
            if (anchor.albumId() != null && !anchor.albumId().isBlank() && !"0".equals(anchor.albumId()))
            {
                snapshotPage.stream().filter(
                        item -> anchor.chatId().equals(item.chatId()) && anchor.albumId().equals(item.albumId()))
                        .forEach(item -> album.putIfAbsent(item.messageId(), item));
            }
            if (album.size() > Math.min(task.getMaxMessages(), TelegramMessageAlbumReader.MAX_ALBUM_MESSAGES))
            {
                task.setStatus("FAILED");
                task.setStatusMessage("相册成员超过本次条数上限，请将上限调整为 10 后重新预览");
                clearLease(task);
                tasks.save(task);
                return;
            }
            acceptedPage = List.copyOf(album.values());
        }
        boolean reachedDateStart = false;
        for (TelegramMessageSnapshot snapshot : acceptedPage)
        {
            if (!java.util.Objects.equals(chatId, snapshot.chatId()))
            {
                continue;
            }
            long messageId = parseId(snapshot.messageId());
            // Include the exact message selected by the user on page one. For later pages,
            // exclude the cursor itself because TDLib history ranges are inclusive.
            if (!albumPreview && (firstLinkPage
                    ? messageId > parseId(startMessageId)
                    : !firstChannelPage && messageId >= currentCursor))
            {
                continue;
            }
            scannedOnPage++;
            // Advance the cursor even when a row is outside the date filter or was
            // already saved. Otherwise a page containing only filtered/duplicate
            // messages would be fetched repeatedly forever.
            if (nextCursor == null || messageId < parseId(nextCursor))
            {
                nextCursor = snapshot.messageId();
            }
            LocalDate messageDate = messageDate(snapshot.sentAtEpochSeconds());
            if ((task.getFromDate() != null || task.getToDate() != null) && messageDate == null)
            {
                continue;
            }
            if (task.getToDate() != null && messageDate != null && messageDate.isAfter(task.getToDate()))
            {
                continue;
            }
            if (task.getFromDate() != null && messageDate != null && messageDate.isBefore(task.getFromDate()))
            {
                reachedDateStart = true;
                continue;
            }
            if (messages.findMessage(task.getId(), chatId, snapshot.messageId()).isPresent())
            {
                continue;
            }
            TelegramCollectedMessage message = toCollectedMessage(task, snapshot);
            messages.save(message);
            mediaQueue.enqueue(task, message);
            saved++;
            if (saved >= task.getMaxMessages())
            {
                break;
            }
            if (scanned + scannedOnPage >= MAX_SCANNED_MESSAGES)
            {
                break;
            }
        }
        boolean noProgress = java.util.Objects.equals(nextCursor, persistedCursor) && scannedOnPage == 0;
        task.setChatId(chatId);
        task.setStartMessageId(startMessageId);
        task.setCollectedMessages(saved);
        task.setScannedMessages(scanned + scannedOnPage);
        task.setCursorMessageId(nextCursor);
        if (!linkSource)
        {
            long newestScannedId = snapshotPage.stream().filter(item -> java.util.Objects.equals(chatId, item.chatId()))
                    .mapToLong(item -> parseId(item.messageId())).max().orElse(0L);
            long previousLiveCursor = parseId(
                    task.getLiveCursorMessageId() == null ? "0" : task.getLiveCursorMessageId());
            task.setLiveCursorMessageId(Long.toString(Math.max(previousLiveCursor, newestScannedId)));
        }
        if (albumPreview)
        {
            task.setStatus("COMPLETED");
            task.setStatusMessage("所选消息及可访问的同组附件已保存，任务完成");
            clearLease(task);
        } else if (saved >= task.getMaxMessages() || snapshotPage.isEmpty() || reachedDateStart
                || scanned + scannedOnPage >= MAX_SCANNED_MESSAGES)
        {
            task.setStatus("COMPLETED");
            task.setStatusMessage(saved >= task.getMaxMessages()
                    ? "已达到本次设置的条数上限，任务完成"
                    : reachedDateStart
                            ? "已到达开始日期，采集范围内的消息已完成"
                            : scanned + scannedOnPage >= MAX_SCANNED_MESSAGES
                                    ? "已达到单次历史检查上限；如需更早消息，请缩小日期范围后分段采集"
                                    : "没有更多可访问的历史消息，任务完成");
            clearLease(task);
        } else if (noProgress)
        {
            task.setStatus("COMPLETED");
            task.setStatusMessage("没有更多可访问的历史消息，任务完成");
            clearLease(task);
        } else
        {
            task.setStatus("QUEUED");
            task.setLeaseOwner(null);
            task.setLeaseExpiresAt(null);
            task.setStatusMessage("已保存一页消息，继续读取更早历史");
        }
        tasks.save(task);
    }

    /**
     * Moves a task to a delayed retry state while an operator reconnects the
     * account.
     */
    @Transactional
    public void waitForAccount(TelegramCollectionTask claimed)
    {
        tasks.lock(claimed.getId()).filter(task -> sameLease(task, claimed)).ifPresent(task -> {
            task.setStatus("WAITING_ACCOUNT");
            task.setLeaseOwner(null);
            task.setLeaseExpiresAt(BusinessTime.now().plusSeconds(10));
            task.setStatusMessage("Telegram 账号尚未连接；连接后系统会从保存的游标继续");
            tasks.save(task);
        });
    }

    /**
     * Ends a task on a safe, bounded failure message without recording exception
     * contents.
     */
    @Transactional
    public void fail(TelegramCollectionTask claimed, String safeMessage)
    {
        tasks.lock(claimed.getId()).filter(task -> sameLease(task, claimed)).ifPresent(task -> {
            task.setStatus("FAILED");
            task.setStatusMessage(safeMessage);
            clearLease(task);
            tasks.save(task);
        });
    }

    private TelegramCollectionTask mutableTask(Long id)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:collect");
        TelegramCollectionTask task = tasks.lock(id)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 采集任务不存在"));
        access.checkData("telegram", task.getOwnerId(), task.getDepartmentId());
        return task;
    }

    private TelegramCollectionTask visibleTask(Long id)
    {
        TelegramCollectionTask task = tasks.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 采集任务不存在"));
        access.checkData("telegram", task.getOwnerId(), task.getDepartmentId());
        return task;
    }

    private boolean sameLease(TelegramCollectionTask task, TelegramCollectionTask claimed)
    {
        return task != null && "RUNNING".equals(task.getStatus())
                && java.util.Objects.equals(task.getLeaseOwner(), claimed.getLeaseOwner())
                && task.getLeaseExpiresAt() != null && task.getLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    /** 将消息进度和独立附件队列进度组合为页面需要的安全摘要。 */
    private TaskView taskView(TelegramCollectionTask task)
    {
        return TaskView.from(task, media.pendingCountForTask(task.getId()));
    }

    private void clearLease(TelegramCollectionTask task)
    {
        task.setLeaseOwner(null);
        task.setLeaseExpiresAt(null);
    }

    private boolean hasTrackingAccess(SysUser owner, TelegramCollectionTask task)
    {
        return owner != null && access.hasFor(owner, "telegram:collect") && access.hasFor(owner, "telegram:view")
                && access.containsFor(owner, "telegram", task.getOwnerId(), task.getDepartmentId());
    }

    private boolean sameTrackingLease(TelegramCollectionTask task, TelegramCollectionTask claimed)
    {
        return task != null && Boolean.TRUE.equals(task.getTrackingEnabled()) && "COMPLETED".equals(task.getStatus())
                && claimed.getLiveLeaseOwner() != null
                && java.util.Objects.equals(task.getLiveLeaseOwner(), claimed.getLiveLeaseOwner())
                && task.getLiveLeaseExpiresAt() != null && task.getLiveLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    private void clearTrackingLease(TelegramCollectionTask task)
    {
        task.setLiveLeaseOwner(null);
        task.setLiveLeaseExpiresAt(null);
    }

    private void stopTracking(TelegramCollectionTask task, String safeMessage)
    {
        task.setTrackingEnabled(false);
        task.setLiveStatusMessage(safeMessage);
        clearTrackingLease(task);
        tasks.save(task);
    }

    /** Refreshes the overlapping checkpoint if Telegram reports a later edit. */
    private void refreshEditedMessage(TelegramCollectionTask task, TelegramMessageSnapshot snapshot)
    {
        TelegramCollectedMessage existing = messages.findMessage(task.getId(), snapshot.chatId(), snapshot.messageId())
                .orElse(null);
        if (existing == null)
        {
            return;
        }
        if (!snapshot.canBeSaved())
        {
            if (Boolean.TRUE.equals(existing.getCanBeSaved()))
            {
                existing.setCanBeSaved(false);
                existing.setContentType("PROTECTED");
                existing.setMessageText(null);
                existing.setMetadataJson("[]");
                existing.setTelegramSentAt(null);
                existing.setTelegramEditedAt(null);
                messages.save(existing);
            }
            return;
        }
        LocalDateTime editedAt = toBusinessTime(snapshot.editedAtEpochSeconds());
        if (editedAt == null
                || (existing.getTelegramEditedAt() != null && !editedAt.isAfter(existing.getTelegramEditedAt())))
        {
            return;
        }
        TelegramCollectedMessage updated = toCollectedMessage(task, snapshot);
        updated.setId(existing.getId());
        messages.save(updated);
    }

    private TelegramCollectedMessage toCollectedMessage(TelegramCollectionTask task, TelegramMessageSnapshot snapshot)
    {
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setOwnerId(task.getOwnerId());
        message.setDepartmentId(task.getDepartmentId());
        message.setTaskId(task.getId());
        message.setChatId(snapshot.chatId());
        message.setTelegramMessageId(snapshot.messageId());
        message.setSenderId(snapshot.senderId());
        message.setCanBeSaved(snapshot.canBeSaved());
        message.setAlbumId(snapshot.albumId());
        message.setTopicId(snapshot.topicId());
        message.setDeleted(false);
        if (snapshot.canBeSaved())
        {
            message.setContentType(snapshot.contentType());
            message.setMessageText(snapshot.text());
            message.setMetadataJson(snapshot.attachmentMetadataJson());
            message.setTelegramSentAt(toBusinessTime(snapshot.sentAtEpochSeconds()));
            message.setTelegramEditedAt(toBusinessTime(snapshot.editedAtEpochSeconds()));
        } else
        {
            message.setContentType("PROTECTED");
            message.setMessageText(null);
            message.setMetadataJson("[]");
            message.setTelegramSentAt(null);
            message.setTelegramEditedAt(null);
        }
        return message;
    }

    private LocalDateTime toBusinessTime(Long timestamp)
    {
        return timestamp == null
                ? null
                : LocalDateTime.ofInstant(Instant.ofEpochSecond(timestamp), BusinessTime.zone());
    }

    /** Converts a Telegram epoch timestamp to the configured business date. */
    private LocalDate messageDate(Long timestamp)
    {
        return timestamp == null
                ? null
                : LocalDateTime.ofInstant(Instant.ofEpochSecond(timestamp), BusinessTime.zone()).toLocalDate();
    }

    private long parseId(String value)
    {
        if (value == null)
        {
            return Long.MAX_VALUE;
        }
        try
        {
            return Long.parseLong(value);
        } catch (NumberFormatException exception)
        {
            throw new BusinessException("Telegram 返回的消息标识无效，任务已停止");
        }
    }

}
