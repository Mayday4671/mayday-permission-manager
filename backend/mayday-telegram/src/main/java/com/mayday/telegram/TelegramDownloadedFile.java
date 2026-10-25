package com.mayday.telegram;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

/**
 * Internal result from the TDLib adapter; the path never enters an API
 * response.
 */
public record TelegramDownloadedFile(Path path, long size) {
    /**
     * Accepts ordinary media from files, and only thumbnail requests from TDLib's
     * separate database/thumbnails cache. Database contents are never exposed.
     */
    static TelegramDownloadedFile checked(Path sessionDirectory, String nativePath, long maxBytes, boolean thumbnail)
            throws IOException
    {
        Path sessionRoot = sessionDirectory.toRealPath();
        Path supplied = Path.of(nativePath);
        Path resolved = supplied.toRealPath();
        boolean allowed = inside(resolved, sessionRoot.resolve("files"), sessionRoot)
                || (thumbnail && inside(resolved, sessionRoot.resolve("database/thumbnails"), sessionRoot));
        if (!allowed || Files.isSymbolicLink(supplied) || !Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS))
        {
            throw new IllegalStateException("Telegram 返回的附件路径不在受控目录内");
        }
        long bytes = Files.size(resolved);
        if (bytes < 1 || bytes > maxBytes)
        {
            throw new IllegalStateException("Telegram 附件超过本机单文件大小限制");
        }
        return new TelegramDownloadedFile(resolved, bytes);
    }

    private static boolean inside(Path file, Path directory, Path sessionRoot) throws IOException
    {
        if (!Files.isDirectory(directory))
            return false;
        Path root = directory.toRealPath();
        return root.equals(directory.normalize()) && root.startsWith(sessionRoot) && file.startsWith(root);
    }
}
