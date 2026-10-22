package com.mayday.telegram;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.mayday.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Runs the deployment-provided 7-Zip executable for RAR/7z archives. Arguments
 * are passed directly to the process without a shell, output is redirected to
 * private temporary files, and every operation has a time and byte limit.
 */
@Component
@RequiredArgsConstructor
class SevenZipArchiveTool
{
    private static final long MAX_LISTING_BYTES = 16L * 1024 * 1024;
    private static final int MAX_ARCHIVE_ENTRIES = 5_000;
    private static final int MAX_ERROR_BYTES = 4 * 1024;
    private static final long PROCESS_TIMEOUT_SECONDS = 180;
    private static final DateTimeFormatter SEVEN_ZIP_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final TelegramSettings settings;

    /** Lists archive metadata without extracting any file to a directory. */
    List<ArchiveToolEntry> list(Path archive)
    {
        Path output = null;
        Path errors = null;
        try
        {
            Path workingDirectory = archive.getParent();
            output = Files.createTempFile(workingDirectory, "telegram-7z-list-", ".txt");
            errors = Files.createTempFile(workingDirectory, "telegram-7z-error-", ".txt");
            Process process = new ProcessBuilder(settings.getSevenZipPath(), "l", "-slt", "-sccUTF-8", "-bd",
                    archive.toString()).directory(workingDirectory.toFile()).redirectOutput(output.toFile())
                    .redirectError(errors.toFile()).start();
            await(process, output, MAX_LISTING_BYTES);
            if (process.exitValue() != 0)
            {
                throw new IOException("7-Zip 无法读取归档");
            }
            byte[] bytes = Files.readAllBytes(output);
            return parseListing(new String(bytes, StandardCharsets.UTF_8));
        } catch (IOException exception)
        {
            throw new BusinessException("压缩包无法安全读取；请确认文件完整且未加密或分卷");
        } finally
        {
            deleteQuietly(output);
            deleteQuietly(errors);
        }
    }

    /**
     * Extracts one validated entry to a random temporary file, never to its archive
     * path.
     */
    long extract(Path archive, String entryName, Path output, long maximumBytes)
    {
        Path errors = null;
        try
        {
            errors = Files.createTempFile(archive.getParent(), "telegram-7z-error-", ".txt");
            Process process = new ProcessBuilder(settings.getSevenZipPath(), "x", "-so", "-y", "-bd", "-spd",
                    archive.toString(), entryName).directory(archive.getParent().toFile())
                    .redirectOutput(output.toFile()).redirectError(errors.toFile()).start();
            await(process, output, maximumBytes);
            if (process.exitValue() != 0)
            {
                throw new IOException("7-Zip 无法提取此归档条目");
            }
            return Files.size(output);
        } catch (IOException exception)
        {
            throw new BusinessException("压缩包条目无法提取；文件可能加密、损坏或超过单文件限制");
        } finally
        {
            deleteQuietly(errors);
        }
    }

    /**
     * Converts 7-Zip technical listing output into simple, bounded file metadata.
     * Duplicate properties and malformed records are rejected rather than guessed.
     */
    static List<ArchiveToolEntry> parseListing(String listing)
    {
        int firstEntry = listing.indexOf("----------");
        if (firstEntry < 0)
        {
            throw new BusinessException("压缩包目录格式无法识别");
        }
        String entriesText = listing.substring(firstEntry + "----------".length());
        List<ArchiveToolEntry> result = new ArrayList<>();
        int totalEntries = 0;
        for (String block : entriesText.split("\\R\\s*\\R"))
        {
            String normalizedBlock = block.strip();
            if (normalizedBlock.isBlank())
            {
                continue;
            }
            Map<String, String> properties = properties(normalizedBlock);
            String name = properties.get("Path");
            if (name == null || name.isBlank())
            {
                throw new BusinessException("压缩包目录包含无效条目");
            }
            if (++totalEntries > MAX_ARCHIVE_ENTRIES)
            {
                throw new BusinessException("压缩包目录条目数超过安全上限");
            }
            if ("+".equals(properties.get("Folder")))
            {
                continue;
            }
            boolean symbolicLink = properties.containsKey("Symbolic Link") || properties.containsKey("Hard Link")
                    || properties.containsKey("Reparse Point")
                    || properties.getOrDefault("Attributes", "").contains("L");
            boolean encrypted = "+".equals(properties.get("Encrypted"));
            final long size;
            try
            {
                size = Long.parseLong(properties.getOrDefault("Size", "-1"));
            } catch (NumberFormatException exception)
            {
                throw new BusinessException("压缩包目录包含无效文件大小");
            }
            if (size < 0)
            {
                throw new BusinessException("压缩包目录包含未知文件大小");
            }
            long modifiedAt = parseModifiedAt(properties.get("Modified"));
            result.add(new ArchiveToolEntry(name, size, modifiedAt, encrypted, symbolicLink));
        }
        return List.copyOf(result);
    }

    private static Map<String, String> properties(String block)
    {
        Map<String, String> result = new LinkedHashMap<>();
        for (String line : block.split("\\R"))
        {
            int separator = line.indexOf(" = ");
            if (separator <= 0)
            {
                throw new BusinessException("压缩包目录字段无法识别");
            }
            String key = line.substring(0, separator);
            if (result.putIfAbsent(key, line.substring(separator + 3)) != null)
            {
                throw new BusinessException("压缩包目录含有歧义字段");
            }
        }
        return result;
    }

    private static long parseModifiedAt(String value)
    {
        if (value == null || value.isBlank())
        {
            return 0;
        }
        try
        {
            return LocalDateTime.parse(value, SEVEN_ZIP_DATE).toInstant(ZoneOffset.UTC).toEpochMilli();
        } catch (DateTimeParseException exception)
        {
            return 0;
        }
    }

    private static void await(Process process, Path output, long outputLimit) throws IOException
    {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(PROCESS_TIMEOUT_SECONDS);
        try
        {
            while (!process.waitFor(100, TimeUnit.MILLISECONDS))
            {
                if (Files.exists(output) && Files.size(output) > outputLimit)
                {
                    throw new IOException("7-Zip 输出超过安全上限");
                }
                if (System.nanoTime() >= deadline)
                {
                    throw new IOException("7-Zip 处理超时");
                }
            }
            if (Files.size(output) > outputLimit)
            {
                throw new IOException("7-Zip 输出超过安全上限");
            }
        } catch (InterruptedException exception)
        {
            Thread.currentThread().interrupt();
            throw new IOException("7-Zip 处理已中断", exception);
        } finally
        {
            if (process.isAlive())
            {
                process.destroyForcibly();
            }
        }
    }

    private static void deleteQuietly(Path path)
    {
        if (path != null)
        {
            try
            {
                Files.deleteIfExists(path);
            } catch (IOException ignored)
            {
                // A randomly named private temporary output cannot be addressed through the
                // API.
            }
        }
    }

    /** 保存外部归档工具解析出的单个文件信息，供业务层统一执行路径与大小安全校验。 */
    record ArchiveToolEntry(String name, long size, long modifiedAt, boolean encrypted, boolean symbolicLink) {
    }
}
