package com.mayday.telegram;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.BusinessTime;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StorageKeys;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.TelegramVideoPreviewContracts.PreviewView;
import com.mayday.telegram.TelegramVideoPreviewProcessor.PreviewAsset;
import com.mayday.telegram.TelegramVideoPreviewProcessor.ProbeResult;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewAssetMapper;
import com.mayday.telegram.mapper.TelegramVideoPreviewMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the persistent, permission-checked HLS preview lifecycle. Queue state
 * and asset references are stored in MySQL; binary objects use the platform
 * storage boundary and are published only after every segment is written
 * successfully.
 */
@Service
@RequiredArgsConstructor
public class TelegramVideoPreviewService
{
    private static final Logger LOGGER = LoggerFactory.getLogger(TelegramVideoPreviewService.class);
    private static final int MAX_ATTEMPTS = 3;
    private static final String HLS_ROOT_NAME = "telegram-hls";
    private static final String MANIFEST_TYPE = "application/vnd.apple.mpegurl";
    private static final String SEGMENT_TYPE = "video/mp2t";

    private final TelegramModuleGuard moduleGuard;
    private final AccessPolicy access;
    private final UserMapper users;
    private final TelegramSettings settings;
    private final StorageSettings storageSettings;
    private final StoredFileContent storedFiles;
    private final TelegramMediaMapper media;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final TelegramVideoPreviewMapper previews;
    private final TelegramVideoPreviewAssetMapper assets;
    private final TelegramVideoPreviewStateService states;
    private final TelegramVideoPreviewProcessor processor;
    private final ConcurrentHashMap<Long, Process> runningProcesses = new ConcurrentHashMap<>();

    /** 排入单媒体预览任务；对总存储配额的预留使用数据库单例行跨实例串行化。 */
    @Transactional
    public PreviewView request(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia source = media.lock(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", source.getOwnerId(), source.getDepartmentId());
        requirePreviewSource(source);
        if (!Objects.equals(previews.lockBudget(), 1))
        {
            throw new IllegalStateException("Telegram 视频预览预算锁记录缺失");
        }
        TelegramVideoPreview task = previews.lockByMediaId(mediaId).orElse(null);
        if (task != null && List.of("QUEUED", "PROCESSING", "READY").contains(task.getStatus()))
        {
            return PreviewView.from(task);
        }
        if (task != null && task.getAttemptCount() != null && task.getAttemptCount() >= MAX_ATTEMPTS)
        {
            throw new BusinessException("此视频已达到预览重试上限；请重新采集附件后重试");
        }
        long mediaReservation = media.reservedStorageBytes(settings.getMaxMediaFileBytes());
        long previewReservation = previews.reservedStorageBytes();
        long requestedReservation = settings.getMaxPreviewOutputBytes();
        long available = settings.getMaxStoredMediaBytes() - mediaReservation - previewReservation;
        if (requestedReservation > available)
        {
            throw new BusinessException("Telegram 文件存储配额不足以安全预留视频预览空间");
        }
        previews.touchBudget();
        if (task == null)
        {
            task = new TelegramVideoPreview();
            task.setOwnerId(source.getOwnerId());
            task.setDepartmentId(source.getDepartmentId());
            task.setMediaId(source.getId());
            task.setAttemptCount(0);
        }
        task.setStatus("QUEUED");
        task.setReservedBytes(requestedReservation);
        task.setFailureMessage(null);
        task.setDurationSeconds(null);
        task.setVideoCodec(null);
        task.setAudioCodec(null);
        task.setTranscoded(null);
        clearLease(task);
        previews.save(task);
        return PreviewView.from(task);
    }

    /** 读取当前视频预览状态，并在 READY 后返回同源受权 HLS 主清单地址。 */
    public PreviewView status(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia source = media.findById(mediaId)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", source.getOwnerId(), source.getDepartmentId());
        TelegramVideoPreview task = previews.findByMediaId(mediaId)
                .orElseThrow(() -> new ResourceNotFoundException("视频预览任务不存在"));
        checkTaskScope(task);
        return PreviewView.from(task);
    }

    /** 取消尚未完成的处理，并终止本实例对应的 FFmpeg/FFprobe 子进程。 */
    @Transactional
    public PreviewView cancel(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        TelegramMedia source = media.findById(mediaId)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", source.getOwnerId(), source.getDepartmentId());
        TelegramVideoPreview task = previews.lockByMediaId(mediaId)
                .orElseThrow(() -> new ResourceNotFoundException("视频预览任务不存在"));
        checkTaskScope(task);
        if (!List.of("QUEUED", "PROCESSING").contains(task.getStatus()))
        {
            throw new BusinessException("只有等待中或处理中的视频预览可以取消");
        }
        task.setStatus("CANCELLED");
        task.setReservedBytes(0L);
        task.setFailureMessage(null);
        clearLease(task);
        previews.save(task);
        Process process = runningProcesses.get(task.getId());
        if (process != null && process.isAlive())
        {
            process.destroyForcibly();
        }
        return PreviewView.from(task);
    }

    /** 在短事务中领取一个任务；完整媒体读取与外部进程不持有数据库锁。 */
    @Transactional
    TelegramVideoPreview claimNext()
    {
        moduleGuard.requireEnabled();
        if (!Objects.equals(previews.lockBudget(), 1) || previews.activeProcessingCount() > 0)
        {
            return null;
        }
        TelegramVideoPreview task = previews.lockNext();
        if (task == null)
        {
            return null;
        }
        SysUser owner = users.findById(task.getOwnerId()).orElse(null);
        TelegramMedia source = media.findById(task.getMediaId()).orElse(null);
        if (!eligibleOwner(owner, task) || !validSourceForOwner(task, source))
        {
            task.setStatus("FAILED");
            task.setReservedBytes(0L);
            task.setFailureMessage("来源附件或任务所有者已失去预览权限");
            clearLease(task);
            previews.save(task);
            return null;
        }
        if (task.getAttemptCount() != null && task.getAttemptCount() >= MAX_ATTEMPTS)
        {
            task.setStatus("FAILED");
            task.setReservedBytes(0L);
            task.setFailureMessage("视频预览已达到最大处理次数");
            clearLease(task);
            previews.save(task);
            return null;
        }
        task.setStatus("PROCESSING");
        task.setAttemptCount((task.getAttemptCount() == null ? 0 : task.getAttemptCount()) + 1);
        task.setLeaseOwner(UUID.randomUUID().toString());
        task.setLeaseExpiresAt(BusinessTime.now().plusSeconds(settings.getPreviewTimeoutSeconds() + 300L));
        task.setFailureMessage(null);
        previews.save(task);
        return task;
    }

    /** 执行一个租约任务；失败、取消或租约过期时删除其所有未发布对象。 */
    void process(TelegramVideoPreview claim)
    {
        List<String> uploadedKeys = new ArrayList<>();
        Path workspace = null;
        try
        {
            TelegramMedia source = workerSource(claim);
            workspace = createWorkspace(source.getActualSize());
            Path input = workspace.resolve("source.media");
            stageSource(source, input);
            java.util.function.BooleanSupplier cancelled = () -> !ownsCurrentLease(claim);
            java.util.function.Consumer<Process> observer = process -> observeProcess(claim.getId(), process);
            ProbeResult probe = processor.probe(input, workspace, observer, cancelled);
            List<PreviewAsset> result = processor.createHls(input, workspace, probe, observer, cancelled);
            String provider = storageSettings.provider();
            FileStorage storage = storedFiles.storage(provider);
            List<TelegramVideoPreviewAsset> rows = new ArrayList<>();
            long totalBytes = 0;
            for (PreviewAsset asset : result)
            {
                if (cancelled.getAsBoolean())
                {
                    throw new BusinessException("视频预览任务已取消或失去工作器租约");
                }
                totalBytes = Math.addExact(totalBytes, asset.size());
                if (totalBytes > settings.getMaxPreviewOutputBytes())
                {
                    throw new BusinessException("HLS 分片总量超过服务端空间上限");
                }
                String key = StorageKeys.create();
                try (InputStream content = Files.newInputStream(asset.path()))
                {
                    storage.write(key, content, asset.size(), asset.contentType());
                }
                uploadedKeys.add(key);
                TelegramVideoPreviewAsset row = new TelegramVideoPreviewAsset();
                row.setPreviewId(claim.getId());
                row.setAssetName(asset.name());
                row.setContentType(asset.contentType());
                row.setStorageProvider(provider);
                row.setStorageKey(key);
                row.setActualSize(asset.size());
                rows.add(row);
            }
            if (!states.publish(claim, probe, rows))
            {
                deleteObjects(storage, uploadedKeys);
                states.fail(claim, "视频来源权限或工作租约已失效，未发布预览文件");
            }
        } catch (RuntimeException | IOException exception)
        {
            deleteObjectsIfPresent(uploadedKeys);
            String reason = exception instanceof BusinessException business
                    ? business.getMessage()
                    : "视频预览处理失败；请检查文件存储与 FFmpeg 配置";
            states.fail(claim, reason);
        } finally
        {
            observeProcess(claim.getId(), null);
            deleteWorkspace(workspace);
        }
    }

    /** 提供 HLS 主清单和分片；每次请求均复核登录权限、数据范围、来源消息与任务策略。 */
    public ResponseEntity<Resource> asset(Long mediaId, String assetName)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:download");
        if (assetName == null || !assetName.matches("(?:index\\.m3u8|segment_[0-9]{5}\\.ts)"))
        {
            throw new ResourceNotFoundException("视频预览资源不存在");
        }
        TelegramMedia source = media.findById(mediaId)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", source.getOwnerId(), source.getDepartmentId());
        requirePreviewSource(source);
        TelegramVideoPreview task = previews.findByMediaId(mediaId).filter(row -> "READY".equals(row.getStatus()))
                .orElseThrow(() -> new ResourceNotFoundException("视频预览资源不存在"));
        checkTaskScope(task);
        TelegramVideoPreviewAsset file = assets.findByPreviewAndName(task.getId(), assetName)
                .orElseThrow(() -> new ResourceNotFoundException("视频预览资源不存在"));
        String expectedType = assetName.endsWith(".m3u8") ? MANIFEST_TYPE : SEGMENT_TYPE;
        if (!expectedType.equals(file.getContentType()) || file.getActualSize() == null || file.getActualSize() < 1)
        {
            throw new BusinessException("视频预览资源状态无效");
        }
        try
        {
            InputStream stream = storedFiles.storage(file.getStorageProvider()).open(file.getStorageKey());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentLength(file.getActualSize())
                    .contentType(MediaType.parseMediaType(expectedType)).header("X-Content-Type-Options", "nosniff")
                    .header("Referrer-Policy", "no-referrer")
                    .header("Content-Security-Policy", "default-src 'none'; sandbox")
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + assetName + "\"")
                    .body(new InputStreamResource(stream));
        } catch (IOException exception)
        {
            throw new BusinessException("读取视频预览资源失败；请检查文件存储服务");
        }
    }

    /** 删除源媒体留存到期后生成的 HLS 资产；失败保留租约状态以便后续重试。 */
    boolean cleanupExpiredOne()
    {
        TelegramVideoPreview claim = states.claimExpired();
        if (claim == null)
        {
            return false;
        }
        List<TelegramVideoPreviewAsset> ownedAssets = assets.findForPreview(claim.getId());
        try
        {
            for (TelegramVideoPreviewAsset asset : ownedAssets)
            {
                storedFiles.storage(asset.getStorageProvider()).delete(asset.getStorageKey());
            }
            states.completeExpiredCleanup(claim);
        } catch (IOException | RuntimeException exception)
        {
            LOGGER.warn("Telegram HLS retention cleanup failed; previewId={}", claim.getId());
        }
        return true;
    }

    private TelegramMedia workerSource(TelegramVideoPreview claim)
    {
        SysUser owner = users.findById(claim.getOwnerId()).orElseThrow(() -> new AccessDeniedException("视频预览所有者已不存在"));
        if (!eligibleOwner(owner, claim))
        {
            throw new AccessDeniedException("视频预览所有者已失去下载权限");
        }
        TelegramMedia source = media.findById(claim.getMediaId())
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        if (!validSourceForOwner(claim, source))
        {
            throw new AccessDeniedException("视频来源任务或消息已不允许预览");
        }
        return source;
    }

    private boolean validSourceForOwner(TelegramVideoPreview preview, TelegramMedia source)
    {
        if (source == null || !Objects.equals(preview.getMediaId(), source.getId())
                || !Objects.equals(preview.getOwnerId(), source.getOwnerId())
                || !Objects.equals(preview.getDepartmentId(), source.getDepartmentId()))
        {
            return false;
        }
        try
        {
            requirePreviewSource(source);
            return true;
        } catch (RuntimeException exception)
        {
            return false;
        }
    }

    private void requirePreviewSource(TelegramMedia source)
    {
        if (!"AVAILABLE".equals(source.getStatus()) || source.getStorageProvider() == null
                || source.getStorageKey() == null || !List.of("video/mp4", "video/webm").contains(source.getMediaType())
                || !List.of("VIDEO", "ANIMATION").contains(source.getKind()))
        {
            throw new BusinessException("只有已下载的 MP4 或 WebM 视频可以生成 HLS 预览");
        }
        TelegramCollectionTask task = tasks.findById(source.getTaskId()).orElse(null);
        TelegramCollectedMessage message = messages.findById(source.getMessageId()).orElse(null);
        if (task == null || message == null || !Boolean.TRUE.equals(task.getDownloadVideos())
                || !Boolean.TRUE.equals(message.getCanBeSaved())
                || !Objects.equals(task.getOwnerId(), source.getOwnerId())
                || !Objects.equals(message.getOwnerId(), source.getOwnerId())
                || !Objects.equals(task.getDepartmentId(), source.getDepartmentId())
                || !Objects.equals(message.getDepartmentId(), source.getDepartmentId())
                || !Objects.equals(message.getTaskId(), source.getTaskId()) || "CANCELLED".equals(task.getStatus()))
        {
            throw new AccessDeniedException("来源消息或采集策略不允许生成视频预览");
        }
    }

    private boolean eligibleOwner(SysUser owner, TelegramVideoPreview task)
    {
        return owner != null && access.hasFor(owner, "telegram:view") && access.hasFor(owner, "telegram:download")
                && access.containsFor(owner, "telegram", task.getOwnerId(), task.getDepartmentId());
    }

    private void checkTaskScope(TelegramVideoPreview task)
    {
        if (!Objects.equals(task.getOwnerId(),
                media.findById(task.getMediaId()).map(TelegramMedia::getOwnerId).orElse(null)))
        {
            throw new AccessDeniedException("视频预览与来源媒体的所有者不一致");
        }
        access.checkData("telegram", task.getOwnerId(), task.getDepartmentId());
    }

    private void stageSource(TelegramMedia source, Path target) throws IOException
    {
        try (InputStream input = storedFiles.storage(source.getStorageProvider()).open(source.getStorageKey());
                var output = Files.newOutputStream(target))
        {
            byte[] buffer = new byte[64 * 1024];
            long copied = 0;
            for (int count; (count = input.read(buffer)) >= 0;)
            {
                if (count > settings.getMaxMediaFileBytes() - copied)
                {
                    throw new IOException("源视频超过服务端单文件上限");
                }
                output.write(buffer, 0, count);
                copied += count;
            }
            if (!Objects.equals(source.getActualSize(), copied))
            {
                throw new IOException("对象存储正文长度与已记录文件大小不一致");
            }
        }
    }

    private Path createWorkspace(long sourceBytes) throws IOException
    {
        Path root = settings.getDataDirectory().toAbsolutePath().normalize().resolve(HLS_ROOT_NAME);
        if (Files.exists(root, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(root))
        {
            throw new IOException("预览工作目录不允许为符号链接");
        }
        Files.createDirectories(root);
        long requiredFreeBytes = Math.addExact(Math.addExact(settings.getMaxPreviewOutputBytes(), sourceBytes),
                settings.getMinimumFreeDiskBytes());
        if (Files.getFileStore(root).getUsableSpace() < requiredFreeBytes)
        {
            throw new IOException("视频预览工作盘空间不足");
        }
        return Files.createTempDirectory(root, "job-");
    }

    private void deleteWorkspace(Path workspace)
    {
        if (workspace == null || !Files.isDirectory(workspace, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(workspace))
        {
            return;
        }
        try (var paths = Files.walk(workspace))
        {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList())
            {
                Files.deleteIfExists(path);
            }
        } catch (IOException exception)
        {
            LOGGER.warn("Telegram HLS temporary workspace cleanup failed");
        }
    }

    private boolean ownsCurrentLease(TelegramVideoPreview claim)
    {
        return previews.findById(claim.getId())
                .map(current -> ownsLease(current, claim) && "PROCESSING".equals(current.getStatus())).orElse(false);
    }

    private boolean ownsLease(TelegramVideoPreview current, TelegramVideoPreview claim)
    {
        return current != null && Objects.equals(current.getId(), claim.getId())
                && Objects.equals(current.getLeaseOwner(), claim.getLeaseOwner()) && current.getLeaseExpiresAt() != null
                && current.getLeaseExpiresAt().isAfter(BusinessTime.now());
    }

    private void observeProcess(Long taskId, Process process)
    {
        if (process == null)
        {
            runningProcesses.remove(taskId);
        } else
        {
            runningProcesses.put(taskId, process);
        }
    }

    private void deleteObjectsIfPresent(List<String> keys)
    {
        FileStorage storage;
        try
        {
            storage = storedFiles.storage(storageSettings.provider());
        } catch (RuntimeException exception)
        {
            LOGGER.warn("Telegram HLS orphan cleanup could not resolve storage");
            return;
        }
        deleteObjects(storage, keys);
    }

    private void deleteObjects(FileStorage storage, List<String> keys)
    {
        for (String key : keys)
        {
            try
            {
                storage.delete(key);
            } catch (IOException | RuntimeException exception)
            {
                // Keys are random and unpublished. Retention/lifecycle cleanup can remove an
                // orphan later.
                LOGGER.warn("Telegram HLS unpublished object cleanup failed");
            }
        }
    }

    private void clearLease(TelegramVideoPreview task)
    {
        task.setLeaseOwner(null);
        task.setLeaseExpiresAt(null);
    }
}
