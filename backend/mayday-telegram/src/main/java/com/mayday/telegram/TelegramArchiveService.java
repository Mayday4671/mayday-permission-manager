package com.mayday.telegram;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
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

/**
 * Provides bounded, read-only ZIP/RAR/7z inspection and single-entry
 * extraction. Archive names are never used as filesystem paths; selected
 * entries are streamed to an operating-system-private temporary file and
 * removed on close.
 */
@Service
@RequiredArgsConstructor
public class TelegramArchiveService
{
    private static final int MAX_ENTRIES = 5_000;
    private static final long MAX_DECLARED_EXPANDED_BYTES = 512L * 1024 * 1024;
    private static final int MAX_PAGE_SIZE = 100;

    private final TelegramModuleGuard moduleGuard;
    private final AccessPolicy access;
    private final TelegramSettings settings;
    private final TelegramMediaMapper media;
    private final TelegramCollectionTaskMapper tasks;
    private final TelegramCollectedMessageMapper messages;
    private final StoredFileContent storedFiles;
    private final SevenZipArchiveTool sevenZip;

    /** Lists only safe regular-file entries and applies bounded server paging. */
    public ArchivePage entries(Long mediaId, int page, int size)
    {
        TelegramMedia source = requireArchive(mediaId);
        PageRequest request = pageRequest(page, size);
        try (StagedArchive staged = stageArchive(source))
        {
            ArchiveFormat format = detectArchiveFormat(staged.path());
            List<ArchiveEntryView> safeEntries;
            if (format == ArchiveFormat.ZIP)
            {
                try (ZipFile zip = openZip(staged.path()))
                {
                    safeEntries = listEntries(zip);
                }
            } else
            {
                safeEntries = listSevenZipEntries(staged.path());
            }
            long requestedStart = (long) (request.page() - 1) * request.size();
            int start = (int) Math.min(requestedStart, safeEntries.size());
            int end = Math.min(start + request.size(), safeEntries.size());
            return new ArchivePage(safeEntries.subList(start, end), safeEntries.size(), request.page(), request.size());
        } catch (IOException exception)
        {
            throw new BusinessException("压缩包无法安全读取；请确认格式完整且未加密或分卷");
        }
    }

    /**
     * Streams one selected archive entry without writing its archive name to disk.
     */
    public ResponseEntity<Resource> entry(Long mediaId, String entryName, String rangeHeader)
    {
        if (!safeEntryName(entryName))
        {
            throw new ResourceNotFoundException("压缩包条目不存在或路径不安全");
        }
        TelegramMedia source = requireArchive(mediaId);
        Path extracted = null;
        try (StagedArchive staged = stageArchive(source))
        {
            ArchiveFormat format = detectArchiveFormat(staged.path());
            if (format == ArchiveFormat.ZIP)
            {
                return extractZipEntry(staged.path(), entryName, rangeHeader);
            }
            List<ArchiveEntryView> safeEntries = listSevenZipEntries(staged.path());
            ArchiveEntryView entry = safeEntries.stream().filter(item -> item.name().equals(entryName)).findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("压缩包条目不存在或路径不安全"));
            if (entry.encrypted() || !entry.withinExtractionLimit())
            {
                throw new BusinessException(entry.encrypted() ? "此压缩包条目已加密，暂不支持输入密码提取" : "此压缩包条目超过单文件提取上限");
            }
            extracted = createTemporaryFile("telegram-entry-", ".bin");
            long actualSize = sevenZip.extract(staged.path(), entryName, extracted, settings.getMaxMediaFileBytes());
            if (entry.size() != actualSize)
            {
                throw new BusinessException("压缩包条目大小与目录声明不一致");
            }
            String type = detectSafeType(extracted);
            ResponseEntity<Resource> response = streamTemporary(extracted, safeFileName(entryName), type, actualSize,
                    rangeHeader);
            extracted = null;
            return response;
        } catch (IOException exception)
        {
            deleteQuietly(extracted);
            throw new BusinessException("压缩包条目解压失败；文件可能损坏或超过单文件限制", exception);
        } catch (RuntimeException exception)
        {
            deleteQuietly(extracted);
            throw exception;
        }
    }

    private TelegramMedia requireArchive(Long mediaId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:extract");
        access.require("telegram:download");
        TelegramMedia row = media.findById(mediaId).orElseThrow(() -> new ResourceNotFoundException("Telegram 媒体不存在"));
        access.checkData("telegram", row.getOwnerId(), row.getDepartmentId());
        if (!"AVAILABLE".equals(row.getStatus()) || row.getStorageProvider() == null || row.getStorageKey() == null)
        {
            throw new BusinessException("压缩包尚未下载完成");
        }
        if (row.getActualSize() == null || row.getActualSize() < 1
                || row.getActualSize() > settings.getMaxMediaFileBytes())
        {
            throw new BusinessException("压缩包文件大小无效或已超过服务端限制");
        }
        TelegramCollectionTask task = tasks.findById(row.getTaskId()).orElse(null);
        TelegramCollectedMessage message = messages.findById(row.getMessageId()).orElse(null);
        if (task == null || message == null || !Boolean.TRUE.equals(message.getCanBeSaved())
                || !java.util.Objects.equals(message.getTaskId(), task.getId())
                || !java.util.Objects.equals(task.getOwnerId(), row.getOwnerId())
                || !java.util.Objects.equals(message.getOwnerId(), row.getOwnerId())
                || !java.util.Objects.equals(task.getDepartmentId(), row.getDepartmentId())
                || !java.util.Objects.equals(message.getDepartmentId(), row.getDepartmentId())
                || !Boolean.TRUE.equals(task.getDownloadDocuments()) || !"DOCUMENT".equals(row.getKind()))
        {
            throw new AccessDeniedException("来源消息或采集策略不允许读取此压缩包");
        }
        if (!List.of("application/zip", "application/vnd.rar", "application/x-7z-compressed")
                .contains(row.getMediaType()))
        {
            throw new BusinessException("当前文件类型不是支持的 ZIP、RAR 或 7z 压缩包");
        }
        return row;
    }

    private StagedArchive stageArchive(TelegramMedia source) throws IOException
    {
        Path path = createTemporaryFile("telegram-archive-", ".bin");
        try (InputStream input = storedFiles.storage(source.getStorageProvider()).open(source.getStorageKey()))
        {
            long copied = copyBounded(input, path, settings.getMaxMediaFileBytes());
            if (copied != source.getActualSize())
            {
                throw new IOException("存储文件大小与数据库记录不匹配");
            }
            return new StagedArchive(path);
        } catch (IOException | RuntimeException exception)
        {
            deleteQuietly(path);
            throw exception;
        }
    }

    private List<ArchiveEntryView> listEntries(ZipFile zip)
    {
        List<ArchiveEntryView> result = new ArrayList<>();
        Set<String> entryNames = new HashSet<>();
        long expandedBytes = 0;
        int totalEntries = 0;
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements())
        {
            ZipEntry entry = entries.nextElement();
            totalEntries++;
            if (totalEntries > MAX_ENTRIES)
            {
                throw new BusinessException("压缩包条目数量或声明展开大小超过安全上限");
            }
            if (entry.isDirectory())
            {
                continue;
            }
            if (entry.getSize() < 0 || entry.getSize() > MAX_DECLARED_EXPANDED_BYTES - expandedBytes)
            {
                throw new BusinessException("压缩包条目数量或声明展开大小超过安全上限");
            }
            expandedBytes += entry.getSize();
            if (safeEntryName(entry.getName()))
            {
                if (!entryNames.add(entry.getName()))
                {
                    throw new BusinessException("压缩包包含重名条目，无法安全选择");
                }
                result.add(new ArchiveEntryView(entry.getName(), entry.getSize(), entry.getTime(),
                        entry.getSize() <= settings.getMaxMediaFileBytes(), false));
            }
        }
        return List.copyOf(result);
    }

    private ResponseEntity<Resource> extractZipEntry(Path archive, String entryName, String rangeHeader)
            throws IOException
    {
        try (ZipFile zip = openZip(archive))
        {
            List<ArchiveEntryView> safeEntries = listEntries(zip);
            ZipEntry entry = zip.getEntry(entryName);
            if (entry == null || entry.isDirectory() || !safeEntryName(entry.getName()))
            {
                throw new ResourceNotFoundException("压缩包条目不存在或路径不安全");
            }
            ArchiveEntryView view = safeEntries.stream().filter(item -> item.name().equals(entryName)).findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("压缩包条目不存在或路径不安全"));
            if (!view.withinExtractionLimit())
            {
                throw new BusinessException("此压缩包条目超过单文件提取上限");
            }
            Path extracted = createTemporaryFile("telegram-entry-", ".bin");
            try
            {
                long actualSize;
                try (InputStream input = zip.getInputStream(entry))
                {
                    actualSize = copyBounded(input, extracted, settings.getMaxMediaFileBytes());
                }
                if (entry.getSize() != actualSize)
                {
                    throw new BusinessException("压缩包条目大小与目录声明不一致");
                }
                return streamTemporary(extracted, safeFileName(entryName), detectSafeType(extracted), actualSize,
                        rangeHeader);
            } catch (IOException | RuntimeException exception)
            {
                deleteQuietly(extracted);
                throw exception;
            }
        }
    }

    private List<ArchiveEntryView> listSevenZipEntries(Path archive)
    {
        List<SevenZipArchiveTool.ArchiveToolEntry> entries = sevenZip.list(archive);
        if (entries.size() > MAX_ENTRIES)
        {
            throw new BusinessException("压缩包条目数量或声明展开大小超过安全上限");
        }
        List<ArchiveEntryView> result = new ArrayList<>();
        Set<String> entryNames = new HashSet<>();
        long expandedBytes = 0;
        for (SevenZipArchiveTool.ArchiveToolEntry entry : entries)
        {
            if (entry.size() > MAX_DECLARED_EXPANDED_BYTES - expandedBytes)
            {
                throw new BusinessException("压缩包条目数量或声明展开大小超过安全上限");
            }
            expandedBytes += entry.size();
            if (entry.symbolicLink() || !safeEntryName(entry.name()))
            {
                continue;
            }
            if (!entryNames.add(entry.name()))
            {
                throw new BusinessException("压缩包包含重名条目，无法安全选择");
            }
            result.add(new ArchiveEntryView(entry.name(), entry.size(), entry.modifiedAt(),
                    entry.size() <= settings.getMaxMediaFileBytes() && !entry.encrypted(), entry.encrypted()));
        }
        return List.copyOf(result);
    }

    private ArchiveFormat detectArchiveFormat(Path path) throws IOException
    {
        byte[] header;
        try (InputStream input = Files.newInputStream(path))
        {
            header = input.readNBytes(8);
        }
        if (header.length >= 4 && header[0] == 'P' && header[1] == 'K' && ((header[2] == 3 && header[3] == 4)
                || (header[2] == 5 && header[3] == 6) || (header[2] == 7 && header[3] == 8)))
        {
            return ArchiveFormat.ZIP;
        }
        if (header.length >= 7 && header[0] == 'R' && header[1] == 'a' && header[2] == 'r' && header[3] == '!'
                && (header[4] & 0xff) == 0x1a && header[5] == 0x07 && (header[6] == 0x00 || header[6] == 0x01))
        {
            return ArchiveFormat.SEVEN_ZIP;
        }
        if (header.length >= 6 && header[0] == '7' && header[1] == 'z' && (header[2] & 0xff) == 0xbc
                && (header[3] & 0xff) == 0xaf && header[4] == '\'' && header[5] == 0x1c)
        {
            return ArchiveFormat.SEVEN_ZIP;
        }
        throw new BusinessException("文件内容不是受支持的 ZIP、RAR 或 7z 格式");
    }

    private ResponseEntity<Resource> streamTemporary(Path path, String fileName, String mediaType, long totalSize,
            String rangeHeader) throws IOException
    {
        TelegramByteRange range = rangeHeader == null || rangeHeader.isBlank()
                ? null
                : TelegramByteRange.parse(rangeHeader, totalSize);
        if (rangeHeader != null && !rangeHeader.isBlank() && range == null)
        {
            deleteQuietly(path);
            return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    .header(HttpHeaders.CONTENT_RANGE, "bytes */" + totalSize).header("Accept-Ranges", "bytes").build();
        }
        InputStream input = Files.newInputStream(path);
        try
        {
            if (range != null)
            {
                input.skipNBytes(range.start());
                input = new BoundedInputStream(input, range.end() - range.start() + 1);
            }
        } catch (IOException exception)
        {
            input.close();
            deleteQuietly(path);
            throw exception;
        }
        input = new DeleteOnCloseInputStream(input, path);
        boolean inline = mediaType.startsWith("image/") || mediaType.equals("video/mp4");
        var builder = ResponseEntity.status(range == null ? HttpStatus.OK : HttpStatus.PARTIAL_CONTENT)
                .cacheControl(CacheControl.noStore())
                .contentLength(range == null ? totalSize : range.end() - range.start() + 1)
                .contentType(MediaType.parseMediaType(mediaType)).header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .header("Referrer-Policy", "no-referrer").header("Accept-Ranges", "bytes")
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        (inline ? ContentDisposition.inline() : ContentDisposition.attachment())
                                .filename(fileName, StandardCharsets.UTF_8).build().toString());
        if (range != null)
        {
            builder.header(HttpHeaders.CONTENT_RANGE,
                    "bytes " + range.start() + "-" + range.end() + "/" + range.total());
        }
        return builder.body(new InputStreamResource(input));
    }

    private String detectSafeType(Path path) throws IOException
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
        return "application/octet-stream";
    }

    private Path createTemporaryFile(String prefix, String suffix) throws IOException
    {
        Path root = settings.getDataDirectory().toAbsolutePath().normalize();
        Files.createDirectories(root);
        return Files.createTempFile(root, prefix, suffix);
    }

    private long copyBounded(InputStream input, Path target, long maximum) throws IOException
    {
        long count = 0;
        byte[] buffer = new byte[32 * 1024];
        try (var output = Files.newOutputStream(target))
        {
            for (int read; (read = input.read(buffer)) != -1;)
            {
                if (read > maximum - count)
                {
                    throw new IOException("ZIP 内容超过单文件限制");
                }
                output.write(buffer, 0, read);
                count += read;
            }
        }
        return count;
    }

    private boolean safeEntryName(String name)
    {
        if (name == null || name.isBlank() || name.startsWith("/") || name.startsWith("\\") || name.contains("\\")
                || name.startsWith("-") || name.contains(":") || name.chars().anyMatch(Character::isISOControl))
        {
            return false;
        }
        for (String segment : name.split("/", -1))
        {
            if (segment.isBlank() || segment.equals(".") || segment.equals(".."))
            {
                return false;
            }
        }
        return true;
    }

    private String safeFileName(String entryName)
    {
        int separator = entryName.lastIndexOf('/');
        String name = separator < 0 ? entryName : entryName.substring(separator + 1);
        return name.replaceAll("[\\r\\n\\\\/\\\"<>|:*?\\p{Cntrl}]", "_").substring(0, Math.min(name.length(), 120));
    }

    private PageRequest pageRequest(int page, int size)
    {
        if (page < 1 || size < 1)
        {
            throw new IllegalArgumentException("页码和每页条数必须大于零");
        }
        return new PageRequest(page, Math.min(size, MAX_PAGE_SIZE));
    }

    private void deleteQuietly(Path path)
    {
        if (path != null)
        {
            try
            {
                Files.deleteIfExists(path);
            } catch (IOException ignored)
            {
                // A random private temporary filename cannot be addressed by API clients.
            }
        }
    }

    private ZipFile openZip(Path path) throws IOException
    {
        return new ZipFile(path.toFile(), StandardCharsets.UTF_8);
    }

    /** 表示归档文件列表的一页结果，保留总数和分页参数供前端稳定展示。 */
    public record ArchivePage(List<ArchiveEntryView> items, int total, int page, int size) {
    }

    /** 表示经过路径、加密状态和解压大小限制校验后的归档条目。 */
    public record ArchiveEntryView(String name, long size, long modifiedAt, boolean withinExtractionLimit,
            boolean encrypted) {
    }

    /** 标识当前归档处理器支持的格式，避免调用方使用未验证的归档类型。 */
    private enum ArchiveFormat {
        ZIP, SEVEN_ZIP
    }

    /** 保存经过服务端上限规整后的页码与每页条数。 */
    private record PageRequest(int page, int size) {
    }

    /** 管理解压到私有临时目录的归档副本，并在资源关闭时清理临时文件。 */
    private final class StagedArchive implements AutoCloseable
    {
        private final Path path;

        private StagedArchive(Path path)
        {
            this.path = path;
        }

        private Path path()
        {
            return path;
        }

        @Override
        public void close()
        {
            deleteQuietly(path);
        }
    }

    /** 将底层读取限制在指定字节数内，避免范围下载越过用户授权的文件区间。 */
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

    /** 包装临时归档条目流，在读取完成或调用方关闭时删除其私有临时文件。 */
    private final class DeleteOnCloseInputStream extends FilterInputStream
    {
        private final Path path;

        private DeleteOnCloseInputStream(InputStream input, Path path)
        {
            super(input);
            this.path = path;
        }

        @Override
        public void close() throws IOException
        {
            try
            {
                super.close();
            } finally
            {
                Files.deleteIfExists(path);
            }
        }
    }
}
