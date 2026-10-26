package com.mayday.telegram;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import com.mayday.common.exception.BusinessException;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;

/**
 * Adapts browser byte ranges to bounded Telegram reads. MP4 metadata near the
 * end of a large file can be fetched independently, without staging the entire
 * video.
 */
final class TelegramRemoteMediaStream
{
    static final int CHUNK_BYTES = 1024 * 1024;

    private TelegramRemoteMediaStream()
    {
    }

    /** Builds a standards-based partial response or a lazily read full download. */
    static ResponseEntity<Resource> response(TelegramSessionClient client, TelegramMedia media, String rangeHeader,
            boolean download)
    {
        int fileId = media.getTelegramFileId();
        long size;
        try
        {
            size = client.fileSize(fileId).get(20, TimeUnit.SECONDS);
        } catch (Exception exception)
        {
            if (exception instanceof InterruptedException)
            {
                Thread.currentThread().interrupt();
            }
            throw new BusinessException("无法读取附件信息，请检查 Telegram 连接后重试");
        }
        TelegramByteRange range = rangeHeader == null ? null : TelegramByteRange.parse(rangeHeader, size);
        if (rangeHeader != null && range == null)
        {
            return ResponseEntity.status(416).header(HttpHeaders.CONTENT_RANGE, "bytes */" + size)
                    .header(HttpHeaders.ACCEPT_RANGES, "bytes").cacheControl(CacheControl.noStore()).build();
        }
        byte[] header = read(client, fileId, 0, (int) Math.min(size, 16));
        String type;
        try
        {
            type = nativeType(header);
        } catch (BusinessException exception)
        {
            if (!download)
                throw exception;
            type = "application/octet-stream";
        }
        long start = range == null ? 0 : range.start();
        // A partial response may return a smaller window than requested. Browsers
        // request subsequent windows as playback advances, keeping requests bounded.
        long end = range == null ? size - 1 : Math.min(range.end(), start + CHUNK_BYTES - 1);
        InputStream input = new RemoteInput(client, fileId, start, end + 1);
        var response = ResponseEntity.status(range == null ? 200 : 206).cacheControl(CacheControl.noStore())
                .contentLength(end - start + 1).header(HttpHeaders.CONTENT_TYPE, type)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes").header("X-Content-Type-Options", "nosniff")
                .header("Referrer-Policy", "no-referrer")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        (download ? ContentDisposition.attachment() : ContentDisposition.inline())
                                .filename(fileName(media, type), StandardCharsets.UTF_8).build().toString());
        if (range != null)
        {
            response.header(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + size);
        }
        return response.body(new InputStreamResource(input));
    }

    /**
     * Ignores untrusted filenames/MIME and accepts only supported binary container
     * signatures.
     */
    static String nativeType(byte[] header)
    {
        if (header.length >= 3 && (header[0] & 255) == 255 && (header[1] & 255) == 216 && (header[2] & 255) == 255)
        {
            return "image/jpeg";
        }
        if (header.length >= 8 && header[0] == (byte) 137 && header[1] == 80 && header[2] == 78 && header[3] == 71
                && header[4] == 13 && header[5] == 10 && header[6] == 26 && header[7] == 10)
        {
            return "image/png";
        }
        if (header.length >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F'
                && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P')
        {
            return "image/webp";
        }
        if (header.length >= 6 && (new String(header, 0, 6, StandardCharsets.US_ASCII).equals("GIF87a")
                || new String(header, 0, 6, StandardCharsets.US_ASCII).equals("GIF89a")))
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
        throw new BusinessException("此附件不支持直接预览；可下载文件，视频可手动转换兼容格式");
    }

    private static String fileName(TelegramMedia media, String type)
    {
        if (media.getFileName() != null && !media.getFileName().isBlank())
        {
            String name = media.getFileName().replace('\\', '/');
            return name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "_");
        }
        String extension = switch (type)
        {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            case "video/mp4" -> ".mp4";
            case "video/webm" -> ".webm";
            default -> ".bin";
        };
        return "telegram-" + media.getId() + extension;
    }

    private static byte[] read(TelegramSessionClient client, int fileId, long offset, int count)
    {
        try
        {
            byte[] data = client.readFileRange(fileId, offset, count).get(90, TimeUnit.SECONDS);
            if (data.length != count)
            {
                throw new IOException("Incomplete range");
            }
            return data;
        } catch (Exception exception)
        {
            if (exception instanceof InterruptedException)
            {
                Thread.currentThread().interrupt();
            }
            throw new BusinessException("附件分段加载失败，请检查 Telegram 连接后重新加载");
        }
    }

    /**
     * Holds at most one chunk and stops requesting Telegram bytes when the response
     * closes.
     */
    private static final class RemoteInput extends InputStream
    {
        private final TelegramSessionClient client;
        private final int fileId;
        private final long end;
        private long position;
        private byte[] buffer = new byte[0];
        private int cursor;
        private boolean closed;

        private RemoteInput(TelegramSessionClient client, int fileId, long start, long end)
        {
            this.client = client;
            this.fileId = fileId;
            this.position = start;
            this.end = end;
        }

        @Override
        public int read() throws IOException
        {
            byte[] one = new byte[1];
            return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] target, int offset, int length) throws IOException
        {
            java.util.Objects.checkFromIndexSize(offset, length, target.length);
            if (closed)
            {
                throw new IOException("Stream closed");
            }
            if (length == 0)
            {
                return 0;
            }
            if (position >= end)
            {
                return -1;
            }
            if (cursor == buffer.length)
            {
                try
                {
                    buffer = TelegramRemoteMediaStream.read(client, fileId, position,
                            (int) Math.min(CHUNK_BYTES, end - position));
                    cursor = 0;
                } catch (BusinessException exception)
                {
                    throw new IOException(exception.getMessage());
                }
            }
            int count = Math.min(length, buffer.length - cursor);
            System.arraycopy(buffer, cursor, target, offset, count);
            cursor += count;
            position += count;
            return count;
        }

        @Override
        public void close()
        {
            closed = true;
            buffer = new byte[0];
        }
    }
}
