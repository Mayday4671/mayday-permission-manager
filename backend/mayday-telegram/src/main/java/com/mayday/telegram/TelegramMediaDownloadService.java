package com.mayday.telegram;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.BusinessTime;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StorageKeys;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns bounded Telegram media downloads and private file delivery.
 *
 * <p>
 * TDLib file handles remain server-side. A download is first claimed with a
 * lease, then copied into the configured shared storage, and only then made
 * visible to users.
 */
@Service
@RequiredArgsConstructor
public class TelegramMediaDownloadService
{
    private static final int MAX_ATTEMPTS = 3;
    private static final java.time.Duration LEASE = java.time.Duration.ofMinutes(10);
    private static final java.time.Duration STREAM_TICKET_TTL = java.time.Duration.ofHours(4);
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final TelegramModuleGuard moduleGuard;
    private final com.mayday.security.AccessPolicy access;
    private final UserMapper users;
    private final TelegramSettings telegramSettings;
    private final StorageSettings storageSettings;
    private final StoredFileContent storedFiles;
    private final TelegramSessionCoordinator sessions;
    private final TelegramMediaMapper media;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final TelegramMediaStateService mediaStates;

    /**
     * Returns an unstarted claim to the queue when the bounded executor is full.
     */
    public void releaseForQueue(TelegramMedia claim)
    {
        mediaStates.releaseForQueue(claim);
    }

    /**
     * Claims at most one bounded media row without holding a database lock during
     * TDLib I/O.
     */
    @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public TelegramMedia claimNext()
    {
        moduleGuard.requireEnabled();
        TelegramMedia row = media.lockNext();
        if (row == null)
        {
            return null;
        }
        SysUser owner = users.findById(row.getOwnerId()).orElse(null);
        if (owner == null || !access.hasFor(owner, "telegram:download") || !access.hasFor(owner, "telegram:view")
                || !access.containsFor(owner, "telegram", row.getOwnerId(), row.getDepartmentId()))
        {
            row.setStatus("FAILED");
            row.setFailureMessage("任务所有者已失去媒体下载权限");
            clearLease(row);
            media.save(row);
            return null;
        }
        TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElse(null);
        TelegramCollectedMessage message = messages.findById(row.getMessageId()).orElse(null);
        if (!selected(task, row.getKind()) || message == null || !Boolean.TRUE.equals(message.getCanBeSaved())
                || !java.util.Objects.equals(message.getTaskId(), row.getTaskId()))
        {
            row.setStatus("FAILED");
            row.setFailureMessage("来源消息不可下载或已失去授权");
            clearLease(row);
            media.save(row);
            return null;
        }
        if (row.getAttemptCount() != null && row.getAttemptCount() >= MAX_ATTEMPTS)
        {
            row.setStatus("FAILED");
            row.setFailureMessage("媒体下载已达到最大重试次数");
            clearLease(row);
            media.save(row);
            return null;
        }
        media.lockStorageBudget();
        long reservedBytes = media.reservedStorageBytes(telegramSettings.getMaxMediaFileBytes())
                + media.previewStorageBytes();
        long ownReservation = "DOWNLOADING".equals(row.getStatus()) ? reservation(row) : 0;
        long available = telegramSettings.getMaxStoredMediaBytes() - Math.max(0, reservedBytes - ownReservation);
        long limit = Math.min(telegramSettings.getMaxMediaFileBytes(), available);
        long expected = row.getExpectedSize() == null ? 0 : row.getExpectedSize();
        if (limit <= 0 || expected > limit)
        {
            row.setStatus("FAILED");
            row.setFailureMessage(telegramSettings.getConfiguredMaxMediaFileBytes() > 0
                    && expected > telegramSettings.getConfiguredMaxMediaFileBytes()
                            ? "附件超过已配置的单文件上限；可在账号与连接中调整媒体设置"
                            : "Telegram 媒体剩余存储空间不足；请清理旧文件或增加总存储容量后重试");
            clearLease(row);
            media.save(row);
            return null;
        }
        // TDLib estimates may differ slightly from the final size. The same reservation
        // bounds the native transfer; unknown sizes reserve the remaining budget.
        row.setReservedBytes(
                expected > 0 ? Math.min(limit, expected + Math.max(16L * 1024 * 1024, expected / 20)) : limit);
        row.setStatus("DOWNLOADING");
        row.setAttemptCount((row.getAttemptCount() == null ? 0 : row.getAttemptCount()) + 1);
        row.setLeaseOwner(UUID.randomUUID().toString());
        row.setLeaseExpiresAt(BusinessTime.now().plus(LEASE));
        row.setFailureMessage(null);
        media.save(row);
        return row;
    }

    private long reservation(TelegramMedia row)
    {
        return row.getReservedBytes() == null ? telegramSettings.getMaxMediaFileBytes() : row.getReservedBytes();
    }

    /**
     * Performs a single claimed file download and atomically publishes its stored
     * reference.
     */
    public void download(TelegramMedia claim)
    {
        String objectKey = StorageKeys.create();
        FileStorage storage = storedFiles.storage(storageSettings.provider());
        try
        {
            verifyFreeDiskSpace(claim);
            TelegramSessionClient client = sessions.requireMediaClient(claim.getOwnerId());
            TelegramDownloadedFile downloaded = downloadWithTimeout(client, claim);
            if (downloaded.size() < 1 || downloaded.size() > reservation(claim))
            {
                throw new SafeMediaException("附件大小超出服务端配置限制");
            }
            String type = detectMediaType(downloaded.path());
            String digest = sha256(downloaded.path(), client, claim);
            try (InputStream input = leasedInput(downloaded.path(), client, claim))
            {
                storage.write(objectKey, input, downloaded.size(), type);
            }
            if (!mediaStates.publish(claim, objectKey, storage.provider(), downloaded.size(), type, digest))
            {
                storage.delete(objectKey);
            }
        } catch (TelegramSessionUnavailableException exception)
        {
            discardIfPresent(storage, objectKey);
            mediaStates.releaseForReconnect(claim);
        } catch (CompletionException | IOException | SafeMediaException exception)
        {
            discardIfPresent(storage, objectKey);
            mediaStates.fail(claim,
                    exception instanceof SafeMediaException safe ? safe.getMessage() : "媒体下载失败；可在权限有效时重试");
        } catch (RuntimeException exception)
        {
            discardIfPresent(storage, objectKey);
            mediaStates.fail(claim, exception instanceof AccessDeniedException ? "任务所有者已失去媒体下载权限" : "媒体下载失败；可稍后重试");
        }
    }

    /** 每秒复核取消与租约；即使消息采集已完成，用户仍可停止后台的附件传输。 */
    TelegramDownloadedFile downloadWithTimeout(TelegramSessionClient client, TelegramMedia claim)
    {
        int fileId = claim.getTelegramFileId();
        requireActiveDownload(client, claim);
        var transfer = client.downloadFile(fileId, reservation(claim));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(telegramSettings.getMediaDownloadTimeoutSeconds());
        try
        {
            while (true)
            {
                requireActiveDownload(client, claim);
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0)
                {
                    cancelUnsharedTransfer(client, claim);
                    throw new SafeMediaException("附件下载超时；请检查网络后重试");
                }
                try
                {
                    TelegramDownloadedFile downloaded = transfer.get(Math.min(remaining, TimeUnit.SECONDS.toNanos(1)),
                            TimeUnit.NANOSECONDS);
                    requireActiveDownload(client, claim);
                    return downloaded;
                } catch (TimeoutException exception)
                {
                    // 短等待仅用于复核任务状态，单次下载的总超时仍由 deadline 控制。
                }
            }
        } catch (InterruptedException exception)
        {
            Thread.currentThread().interrupt();
            cancelUnsharedTransfer(client, claim);
            throw new SafeMediaException("附件下载已中断");
        } catch (ExecutionException exception)
        {
            Throwable cause = exception.getCause();
            if (cause instanceof RuntimeException runtimeException)
            {
                throw runtimeException;
            }
            throw new SafeMediaException("附件下载失败；可稍后重试");
        }
    }

    /** 失去任务或租约后禁止继续传输和发布；检查不持有跨网络等待的数据库事务。 */
    private void requireActiveDownload(TelegramSessionClient client, TelegramMedia claim)
    {
        TelegramCollectionTask task = tasks.findById(claim.getTaskId()).orElse(null);
        TelegramMedia current = media.findById(claim.getId()).orElse(null);
        if (task == null || "CANCELLED".equals(task.getStatus()) || current == null
                || !"DOWNLOADING".equals(current.getStatus())
                || !java.util.Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner())
                || current.getLeaseExpiresAt() == null || !current.getLeaseExpiresAt().isAfter(BusinessTime.now()))
        {
            cancelUnsharedTransfer(client, claim);
            throw new SafeMediaException("来源采集任务已取消或下载租约已失效，附件下载已停止");
        }
        if (current.getLeaseExpiresAt().isBefore(BusinessTime.now().plusMinutes(5)) && !mediaStates.renew(claim))
        {
            cancelUnsharedTransfer(client, claim);
            throw new SafeMediaException("下载租约续期失败，附件下载已停止");
        }
    }

    /**
     * Keeps cancellation and lease fencing active during large-file hashing and
     * storage copies.
     */
    private InputStream leasedInput(java.nio.file.Path path, TelegramSessionClient client, TelegramMedia claim)
            throws IOException
    {
        return new FilterInputStream(Files.newInputStream(path)) {
            private long nextCheck;

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException
            {
                if (System.nanoTime() >= nextCheck)
                {
                    requireActiveDownload(client, claim);
                    nextCheck = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
                }
                return in.read(buffer, offset, length);
            }
        };
    }

    /** TDLib 按文件而非业务任务取消，仍被其他任务使用的文件保持传输。 */
    private void cancelUnsharedTransfer(TelegramSessionClient client, TelegramMedia claim)
    {
        TelegramMedia current = media.findById(claim.getId()).orElse(null);
        // 同一记录也可能已被新工作器接管；按其他记录统计共享下载无法覆盖此情形。
        if (current != null && "DOWNLOADING".equals(current.getStatus()) && current.getLeaseOwner() != null
                && !java.util.Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner())
                && current.getLeaseExpiresAt() != null && current.getLeaseExpiresAt().isAfter(BusinessTime.now()))
        {
            return;
        }
        if (media.otherActiveDownloads(claim.getTelegramFileId(), claim.getId()) == 0)
        {
            client.cancelDownloadFile(claim.getTelegramFileId());
        }
    }

    /**
     * Reserves room for the temporary TDLib file and, for local storage, its
     * published copy.
     */
    private void verifyFreeDiskSpace(TelegramMedia claim)
    {
        try
        {
            long fileBytes = reservation(claim);
            long freeReserve = telegramSettings.getMinimumFreeDiskBytes();
            java.nio.file.FileStore sessionStore = fileStoreFor(telegramSettings.getDataDirectory());
            long sessionRequired = Math.addExact(fileBytes, freeReserve);
            if (sessionStore.getUsableSpace() < sessionRequired)
            {
                throw new SafeMediaException("服务端临时磁盘空间不足；请释放空间后重试");
            }
            if ("LOCAL".equals(storageSettings.provider()))
            {
                java.nio.file.FileStore storageStore = fileStoreFor(storageSettings.localRoot());
                long storageRequired = Math.addExact(fileBytes, freeReserve);
                if (sessionStore.equals(storageStore))
                {
                    storageRequired = Math.addExact(Math.multiplyExact(fileBytes, 2), freeReserve);
                }
                if (storageStore.getUsableSpace() < storageRequired)
                {
                    throw new SafeMediaException("服务端文件存储空间不足；请释放空间后重试");
                }
            }
        } catch (IOException | ArithmeticException exception)
        {
            throw new SafeMediaException("无法确认服务端可用磁盘空间；请检查存储配置");
        }
    }

    /**
     * Finds an existing ancestor so disk checks also work before the configured
     * directory is created.
     */
    private java.nio.file.FileStore fileStoreFor(java.nio.file.Path configuredPath) throws IOException
    {
        java.nio.file.Path existingPath = configuredPath.toAbsolutePath().normalize();
        while (existingPath != null && !Files.exists(existingPath, java.nio.file.LinkOption.NOFOLLOW_LINKS))
        {
            existingPath = existingPath.getParent();
        }
        if (existingPath == null || Files.isSymbolicLink(existingPath))
        {
            throw new IOException("配置目录没有安全的磁盘挂载点");
        }
        return Files.getFileStore(existingPath);
    }

    /**
     * Streams a stored object only after checking permission, data scope, message
     * protection, and ready state.
     */
    public ResponseEntity<Resource> content(Long mediaId, String rangeHeader)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia row = visibleMedia(mediaId);
        return streamContent(row, rangeHeader);
    }

    /**
     * Reads only Telegram's small source cover. Resolving the stored message first
     * supports public search results after reconnecting, without joining a channel
     * or trusting an obsolete native file handle.
     */
    public byte[] thumbnail(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        access.require("telegram:download");
        TelegramMedia row = visibleMedia(mediaId);
        TelegramCollectedMessage source = messages.findById(row.getMessageId()).orElseThrow();
        TelegramCollectionTask task = tasks.findById(row.getTaskId())
                .orElseThrow(() -> new ResourceNotFoundException("来源采集记录不存在"));
        TelegramSessionClient client = sessions.requireMediaClient(row.getOwnerId());
        try
        {
            byte[] bytes = client
                    .resolveMediaFile(task.getMessageLink(), source.getChatId(), source.getTelegramMessageId(),
                            row.getAttachmentIndex())
                    .thenCompose(ignored -> client.channelThumbnail(source.getChatId(), source.getTelegramMessageId()))
                    .get(30, TimeUnit.SECONDS);
            if (bytes == null || bytes.length == 0 || bytes.length > TelegramChannelThumbnail.MAX_BYTES)
            {
                throw new BusinessException("原消息没有可用的封面");
            }
            TelegramChannelThumbnail.contentType(bytes);
            return bytes;
        } catch (Exception exception)
        {
            if (exception instanceof InterruptedException)
            {
                Thread.currentThread().interrupt();
            }
            throw new BusinessException("封面暂不可用，请检查账号连接后重试");
        }
    }

    /**
     * Creates a short-lived opaque playback capability; only its digest and
     * expiration are persisted.
     */
    @Transactional
    public TelegramCollectionContracts.MediaStreamTicketView createStreamTicket(Long mediaId)
    {
        return issueTicket(mediaId, false);
    }

    /**
     * Issues a separate private capability so large files bypass browser Blob
     * buffering.
     */
    @Transactional
    public TelegramCollectionContracts.MediaStreamTicketView createDownloadTicket(Long mediaId)
    {
        return issueTicket(mediaId, true);
    }

    private TelegramCollectionContracts.MediaStreamTicketView issueTicket(Long mediaId, boolean download)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia row = media.lock(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", row.getOwnerId(), row.getDepartmentId());
        verifySource(row);
        if (!download && !"REMOTE".equals(row.getStatus())
                && !List.of("video/mp4", "video/webm").contains(row.getMediaType()))
        {
            throw new BusinessException("受权原视频打开仅支持 MP4 与 WebM 视频");
        }
        byte[] raw = new byte[32];
        SECURE_RANDOM.nextBytes(raw);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        java.util.Arrays.fill(raw, (byte) 0);
        LocalDateTime expiresAt = BusinessTime.now().plus(STREAM_TICKET_TTL);
        if (download)
        {
            row.setDownloadTicketHash(sha256(ticket.getBytes(StandardCharsets.US_ASCII)));
            row.setDownloadTicketExpiresAt(expiresAt);
        } else
        {
            row.setStreamTicketHash(sha256(ticket.getBytes(StandardCharsets.US_ASCII)));
            row.setStreamTicketExpiresAt(expiresAt);
        }
        media.save(row);
        return new TelegramCollectionContracts.MediaStreamTicketView(
                "/api/telegram/media/" + row.getId() + (download ? "/download?ticket=" : "/stream?ticket=") + ticket,
                expiresAt);
    }

    /**
     * Serves native browser Range requests; the capability is scoped to one media
     * row and rechecks current roles.
     */
    public ResponseEntity<Resource> stream(Long mediaId, String ticket, String rangeHeader)
    {
        return stream(mediaId, ticket, rangeHeader, "original");
    }

    /**
     * The playback capability covers only renditions of this exact authorized media
     * source.
     */
    public ResponseEntity<Resource> stream(Long mediaId, String ticket, String rangeHeader, String quality)
    {
        return capabilityContent(mediaId, ticket, rangeHeader, false, quality);
    }

    /**
     * Streams an attachment to the browser download manager using a scoped
     * capability.
     */
    public ResponseEntity<Resource> downloadContent(Long mediaId, String ticket, String rangeHeader)
    {
        return capabilityContent(mediaId, ticket, rangeHeader, true, "original");
    }

    private ResponseEntity<Resource> capabilityContent(Long mediaId, String ticket, String rangeHeader,
            boolean download, String quality)
    {
        moduleGuard.requireEnabled();
        TelegramMedia row = media.findById(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        verifyStreamTicket(row, ticket, download);
        SysUser owner = users.findById(row.getOwnerId()).orElseThrow(() -> new AccessDeniedException("播放票据所有者已不存在"));
        if (!access.hasFor(owner, "telegram:download") || !access.hasFor(owner, "telegram:view")
                || !access.containsFor(owner, "telegram", row.getOwnerId(), row.getDepartmentId()))
        {
            throw new AccessDeniedException("播放票据所有者已失去媒体访问权限");
        }
        verifySource(row);
        if (!"original".equals(quality))
        {
            if (quality == null || !quality.matches("alt:-?[0-9]{1,20}"))
            {
                throw new BusinessException("视频清晰度标识无效");
            }
            TelegramVideoQuality rendition = sourceQualities(row).stream().filter(item -> item.id().equals(quality))
                    .findFirst().orElseThrow(() -> new BusinessException("原消息未提供该清晰度，请重新选择"));
            // Keep the stored original untouched; every request resolves the current native
            // handle.
            TelegramMedia selected = new TelegramMedia();
            selected.setId(row.getId());
            selected.setTelegramFileId(rendition.fileId());
            return TelegramRemoteMediaStream.response(sessions.requireMediaClient(row.getOwnerId()), selected,
                    rangeHeader, false);
        }
        return streamContent(row, rangeHeader, download);
    }

    /**
     * Lists source-provided qualities under the same ownership checks as playback.
     */
    public List<TelegramVideoQuality.VideoQualityView> videoQualities(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        access.require("telegram:download");
        TelegramMedia row = visibleMedia(mediaId);
        return sourceQualities(row).stream().map(TelegramVideoQuality::view).toList();
    }

    private List<TelegramVideoQuality> sourceQualities(TelegramMedia row)
    {
        if (!"VIDEO".equals(row.getKind()))
        {
            throw new BusinessException("此附件未提供多清晰度视频");
        }
        TelegramCollectedMessage source = messages.findById(row.getMessageId()).orElseThrow();
        TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElseThrow();
        TelegramSessionClient client = sessions.requireMediaClient(row.getOwnerId());
        try
        {
            return client.videoQualities(task.getMessageLink(), source.getChatId(), source.getTelegramMessageId())
                    .get(25, TimeUnit.SECONDS);
        } catch (Exception exception)
        {
            if (exception instanceof InterruptedException)
            {
                Thread.currentThread().interrupt();
            }
            throw new BusinessException("无法读取视频清晰度，请检查 Telegram 连接后重试");
        }
    }

    private TelegramMedia visibleMedia(Long mediaId)
    {
        TelegramMedia row = media.findById(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", row.getOwnerId(), row.getDepartmentId());
        verifySource(row);
        return row;
    }

    private void verifySource(TelegramMedia row)
    {
        boolean remote = "REMOTE".equals(row.getStatus());
        if (!remote && (!"AVAILABLE".equals(row.getStatus()) || row.getStorageKey() == null
                || row.getStorageProvider() == null))
        {
            throw new BusinessException("媒体文件尚未下载完成");
        }
        TelegramCollectedMessage source = messages.findById(row.getMessageId())
                .orElseThrow(() -> new ResourceNotFoundException("来源消息不存在"));
        if (!Boolean.TRUE.equals(source.getCanBeSaved())
                || !java.util.Objects.equals(source.getTaskId(), row.getTaskId()))
        {
            throw new AccessDeniedException("来源消息禁止保存或访问");
        }
        if (remote)
        {
            TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElse(null);
            if (task == null || !Boolean.TRUE.equals(task.getPreviewOnly()) || "CANCELLED".equals(task.getStatus())
                    || row.getTelegramFileId() == null || row.getTelegramFileId() <= 0
                    || !List.of("PHOTO", "VIDEO", "ANIMATION", "DOCUMENT", "AUDIO", "VOICE").contains(row.getKind()))
            {
                throw new AccessDeniedException("附件预览来源已失效，请重新读取原消息");
            }
        }
    }

    private void verifyStreamTicket(TelegramMedia row, String ticket, boolean download)
    {
        String digest = download ? row.getDownloadTicketHash() : row.getStreamTicketHash();
        LocalDateTime expiration = download ? row.getDownloadTicketExpiresAt() : row.getStreamTicketExpiresAt();
        if (ticket == null || !ticket.matches("[A-Za-z0-9_-]{40,64}") || digest == null || expiration == null
                || !expiration.isAfter(BusinessTime.now()))
        {
            throw new AccessDeniedException("播放票据无效或已过期");
        }
        byte[] expected = digest.getBytes(StandardCharsets.US_ASCII);
        byte[] actual = sha256(ticket.getBytes(StandardCharsets.US_ASCII)).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, actual))
        {
            throw new AccessDeniedException("播放票据无效或已过期");
        }
    }

    private ResponseEntity<Resource> streamContent(TelegramMedia row, String rangeHeader)
    {
        return streamContent(row, rangeHeader, false);
    }

    private ResponseEntity<Resource> streamContent(TelegramMedia row, String rangeHeader, boolean download)
    {
        if ("REMOTE".equals(row.getStatus()))
        {
            TelegramSessionClient client = sessions.requireMediaClient(row.getOwnerId());
            TelegramCollectedMessage source = messages.findById(row.getMessageId()).orElseThrow();
            TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElseThrow();
            try
            {
                // Never trust a persisted native handle after a session restart; an
                // old integer can be missing or identify a different file in TDLib.
                row.setTelegramFileId(client.resolveMediaFile(task.getMessageLink(), source.getChatId(),
                        source.getTelegramMessageId(), row.getAttachmentIndex()).get(25, TimeUnit.SECONDS));
            } catch (Exception exception)
            {
                if (exception instanceof InterruptedException)
                {
                    Thread.currentThread().interrupt();
                }
                throw new BusinessException("无法定位原附件，请检查账号连接或重新读取原消息");
            }
            return TelegramRemoteMediaStream.response(client, row, rangeHeader, download);
        }
        try
        {
            long totalSize = row.getActualSize();
            TelegramByteRange range = rangeHeader == null || rangeHeader.isBlank()
                    ? null
                    : TelegramByteRange.parse(rangeHeader, totalSize);
            if (rangeHeader != null && !rangeHeader.isBlank() && range == null)
            {
                return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        .header(HttpHeaders.CONTENT_RANGE, "bytes */" + totalSize).header("Accept-Ranges", "bytes")
                        .build();
            }
            FileStorage storage = storedFiles.storage(row.getStorageProvider());
            InputStream input = range == null
                    ? storage.open(row.getStorageKey())
                    : new BoundedInputStream(storage.openRange(row.getStorageKey(), range.start()),
                            range.end() - range.start() + 1);
            String fileName = safeFileName(row.getFileName());
            boolean inline = !download && row.getMediaType() != null && (row.getMediaType().startsWith("image/")
                    || List.of("video/mp4", "video/webm").contains(row.getMediaType()));
            ContentDisposition disposition = (inline ? ContentDisposition.inline() : ContentDisposition.attachment())
                    .filename(fileName, java.nio.charset.StandardCharsets.UTF_8).build();
            ResponseEntity.BodyBuilder response = ResponseEntity
                    .status(range == null ? HttpStatus.OK : HttpStatus.PARTIAL_CONTENT)
                    .cacheControl(CacheControl.noStore())
                    .contentLength(range == null ? totalSize : range.end() - range.start() + 1)
                    .contentType(MediaType.parseMediaType(
                            row.getMediaType() == null ? "application/octet-stream" : row.getMediaType()))
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Content-Security-Policy", "default-src 'none'; sandbox").header("Accept-Ranges", "bytes")
                    .header("Referrer-Policy", "no-referrer")
                    .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString());
            if (range != null)
            {
                response.header(HttpHeaders.CONTENT_RANGE,
                        "bytes " + range.start() + "-" + range.end() + "/" + range.total());
            }
            return response.body(new InputStreamResource(input));
        } catch (IOException exception)
        {
            throw new BusinessException("读取媒体文件失败，请检查文件存储服务");
        }
    }

    /**
     * Requeues one failed attachment only when the owner, task policy, source
     * message, and retry limit still allow it.
     */
    @Transactional
    public TelegramCollectionContracts.MediaView retry(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia row = media.lock(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", row.getOwnerId(), row.getDepartmentId());
        boolean expired = "EXPIRED".equals(row.getStatus());
        boolean remote = "REMOTE".equals(row.getStatus());
        if (!expired && !remote && !"FAILED".equals(row.getStatus()))
        {
            throw new BusinessException("只有下载失败或已过期的附件可以重新下载");
        }
        if (!expired && row.getAttemptCount() != null && row.getAttemptCount() >= MAX_ATTEMPTS)
        {
            throw new BusinessException("附件已达到最大尝试次数，请重新创建采集任务");
        }
        TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElse(null);
        TelegramCollectedMessage source = messages.findById(row.getMessageId()).orElse(null);
        if (!selected(task, row.getKind()) || task == null || "CANCELLED".equals(task.getStatus()) || source == null
                || !Boolean.TRUE.equals(source.getCanBeSaved()))
        {
            throw new AccessDeniedException("来源消息或任务已不允许下载此附件");
        }
        row.setStatus("QUEUED");
        row.setFailureMessage(null);
        row.setActualSize(null);
        row.setMediaType(null);
        row.setStorageKey(null);
        row.setStorageProvider(null);
        row.setSha256(null);
        row.setStreamTicketHash(null);
        row.setStreamTicketExpiresAt(null);
        row.setDownloadTicketHash(null);
        row.setDownloadTicketExpiresAt(null);
        if (expired)
        {
            row.setAttemptCount(0);
        }
        clearLease(row);
        media.save(row);
        return new TelegramCollectionContracts.MediaView(row.getId(), row.getKind(), row.getFileName(),
                row.getExpectedSize(), row.getActualSize(), row.getMediaType(), row.getStatus(), null, null);
    }

    private void discardIfPresent(FileStorage storage, String key)
    {
        try
        {
            storage.delete(key);
        } catch (IOException ignored)
        {
            // The orphan key is random and inaccessible; storage lifecycle cleanup can
            // safely remove it later.
        }
    }

    private String detectMediaType(java.nio.file.Path path) throws IOException
    {
        byte[] header;
        try (InputStream input = Files.newInputStream(path))
        {
            header = input.readNBytes(16);
        }
        if (header.length >= 3 && (header[0] & 0xff) == 0xff && (header[1] & 0xff) == 0xd8
                && (header[2] & 0xff) == 0xff)
        {
            return "image/jpeg";
        }
        if (header.length >= 8 && (header[0] & 0xff) == 0x89 && header[1] == 'P' && header[2] == 'N'
                && header[3] == 'G')
        {
            return "image/png";
        }
        if (header.length >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F'
                && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P')
        {
            return "image/webp";
        }
        if (header.length >= 6 && header[0] == 'G' && header[1] == 'I' && header[2] == 'F')
        {
            return "image/gif";
        }
        if (header.length >= 12 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p')
        {
            return "video/mp4";
        }
        if (header.length >= 4 && (header[0] & 0xff) == 0x1a && (header[1] & 0xff) == 0x45 && (header[2] & 0xff) == 0xdf
                && (header[3] & 0xff) == 0xa3)
        {
            return "video/webm";
        }
        if (header.length >= 4 && header[0] == 'P' && header[1] == 'K' && ((header[2] == 3 && header[3] == 4)
                || (header[2] == 5 && header[3] == 6) || (header[2] == 7 && header[3] == 8)))
        {
            return "application/zip";
        }
        if (header.length >= 7 && header[0] == 'R' && header[1] == 'a' && header[2] == 'r' && header[3] == '!'
                && (header[4] & 0xff) == 0x1a && header[5] == 0x07 && (header[6] == 0x00 || header[6] == 0x01))
        {
            return "application/vnd.rar";
        }
        if (header.length >= 6 && header[0] == '7' && header[1] == 'z' && (header[2] & 0xff) == 0xbc
                && (header[3] & 0xff) == 0xaf && header[4] == '\'' && header[5] == 0x1c)
        {
            return "application/x-7z-compressed";
        }
        return "application/octet-stream";
    }

    private String sha256(java.nio.file.Path path, TelegramSessionClient client, TelegramMedia claim) throws IOException
    {
        try
        {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = leasedInput(path, client, claim))
            {
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) >= 0;)
                {
                    digest.update(buffer, 0, count);
                }
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("当前 Java 环境缺少 SHA-256", exception);
        }
    }

    private String sha256(byte[] value)
    {
        try
        {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("当前 Java 环境缺少 SHA-256", exception);
        }
    }

    private boolean selected(TelegramCollectionTask task, String kind)
    {
        if (task == null)
        {
            return false;
        }
        return switch (kind)
        {
            case "PHOTO" -> Boolean.TRUE.equals(task.getDownloadImages());
            case "VIDEO", "ANIMATION" -> Boolean.TRUE.equals(task.getDownloadVideos());
            case "DOCUMENT", "AUDIO", "VOICE" -> Boolean.TRUE.equals(task.getDownloadDocuments());
            default -> false;
        };
    }

    private String safeFileName(String value)
    {
        if (value == null || value.isBlank())
        {
            return "telegram-media";
        }
        return value.replaceAll("[\\r\\n\\\\/\"<>|:*?\\p{Cntrl}]", "_").substring(0, Math.min(value.length(), 120));
    }

    /**
     * Stops a range response after the exact advertised byte count and closes the
     * provider stream.
     */
    private static final class BoundedInputStream extends FilterInputStream
    {
        private long remaining;

        private BoundedInputStream(InputStream input, long length)
        {
            super(input);
            remaining = length;
        }

        @Override
        public int read() throws IOException
        {
            if (remaining == 0)
            {
                return -1;
            }
            int value = super.read();
            if (value >= 0)
            {
                remaining--;
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException
        {
            if (remaining == 0)
            {
                return -1;
            }
            int count = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (count > 0)
            {
                remaining -= count;
            }
            return count;
        }
    }

    private void clearLease(TelegramMedia row)
    {
        row.setLeaseOwner(null);
        row.setLeaseExpiresAt(null);
    }

    /** 保存可安全反馈给用户的媒体下载失败原因，避免泄漏底层网络或存储细节。 */
    private static final class SafeMediaException extends RuntimeException
    {
        private SafeMediaException(String message)
        {
            super(message);
        }
    }
}
