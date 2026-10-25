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
final class TelegramRemoteVideoStream
{
    static final int CHUNK_BYTES = 1024 * 1024;

    private TelegramRemoteVideoStream()
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
            throw new BusinessException("无法读取视频信息，请检查 Telegram 连接后重试");
        }
        TelegramByteRange range = rangeHeader == null ? null : TelegramByteRange.parse(rangeHeader, size);
        if (rangeHeader != null && range == null)
        {
            return ResponseEntity.status(416).header(HttpHeaders.CONTENT_RANGE, "bytes */" + size)
                    .header(HttpHeaders.ACCEPT_RANGES, "bytes").cacheControl(CacheControl.noStore()).build();
        }
        byte[] header = read(client, fileId, 0, (int) Math.min(size, 16));
        String type = nativeType(header);
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
                                .filename("telegram-" + media.getId() + ("video/mp4".equals(type) ? ".mp4" : ".webm"),
                                        StandardCharsets.UTF_8)
                                .build().toString());
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
        if (header.length >= 12 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p')
        {
            return "video/mp4";
        }
        if (header.length >= 4 && (header[0] & 0xff) == 0x1a && (header[1] & 0xff) == 0x45 && (header[2] & 0xff) == 0xdf
                && (header[3] & 0xff) == 0xa3)
        {
            return "video/webm";
        }
        throw new BusinessException("此附件不是浏览器支持的视频容器，请使用兼容转换");
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
            throw new BusinessException("视频分段加载失败，请检查 Telegram 连接后重新加载");
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
                    buffer = TelegramRemoteVideoStream.read(client, fileId, position,
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
