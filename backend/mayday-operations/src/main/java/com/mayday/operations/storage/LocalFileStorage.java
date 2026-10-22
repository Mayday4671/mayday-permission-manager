package com.mayday.operations.storage;

import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

import org.springframework.stereotype.Component;

/** 本地存储采用临时文件完整写入后原子替换；不使用用户名称拼磁盘路径。 根目录与分片目录均禁止符号链接，读取和删除再次检查，避免目录替换后的路径逃逸。 */
@Component
public class LocalFileStorage implements FileStorage
{
    private final Path root;

    public LocalFileStorage(StorageSettings settings)
    {
        root = settings.localRoot();
    }

    @Override
    public String provider()
    {
        return "LOCAL";
    }

    private Path resolve(String key, boolean create) throws IOException
    {
        StorageKeys.validate(key);
        if (create)
        {
            Files.createDirectories(root);
        }
        if (Files.isSymbolicLink(root))
        {
            throw new IOException("存储根目录不能是符号链接");
        }
        Path directory = root.resolve(key.substring(0, 2));
        if (create)
        {
            Files.createDirectories(directory);
        }
        if (Files.isSymbolicLink(directory))
        {
            throw new IOException("存储分片不能是符号链接");
        }
        Path target = root.resolve(key).normalize();
        if (!target.startsWith(root) || Files.isSymbolicLink(target))
        {
            throw new IOException("存储路径无效");
        }
        if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS) && !directory.toRealPath().startsWith(root.toRealPath()))
        {
            throw new IOException("存储路径不在根目录内");
        }
        return target;
    }

    @Override
    public void write(String key, InputStream content, long length, String contentType) throws IOException
    {
        Path destination = resolve(key, true);
        Path temporary = Files.createTempFile(destination.getParent(), ".upload-", ".tmp");
        try
        {
            long actual = Files.copy(content, temporary, StandardCopyOption.REPLACE_EXISTING);
            if (actual != length)
            {
                throw new IOException("文件正文长度与上传声明不一致");
            }
            Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE);
        } finally
        {
            Files.deleteIfExists(temporary);
        }
    }

    @Override
    public InputStream open(String key) throws IOException
    {
        return Files.newInputStream(resolve(key, false), LinkOption.NOFOLLOW_LINKS);
    }

    /**
     * Seeks through the local file channel instead of reading and discarding
     * earlier video bytes.
     */
    @Override
    public InputStream openRange(String key, long offset) throws IOException
    {
        if (offset < 0)
        {
            throw new IllegalArgumentException("文件偏移量不能小于 0");
        }
        SeekableByteChannel channel = Files.newByteChannel(resolve(key, false), StandardOpenOption.READ,
                LinkOption.NOFOLLOW_LINKS);
        try
        {
            channel.position(offset);
            return Channels.newInputStream(channel);
        } catch (IOException exception)
        {
            channel.close();
            throw exception;
        }
    }

    @Override
    public void delete(String key) throws IOException
    {
        Files.deleteIfExists(resolve(key, false));
    }
}
