package com.mayday.telegram;

import java.util.Arrays;
import java.util.Comparator;

import it.tdlight.jni.TdApi;
import org.jspecify.annotations.Nullable;

/**
 * Selects a small raster preview without ever falling back to the original
 * video or document.
 */
final class TelegramChannelThumbnail
{
    static final long MAX_BYTES = 2 * 1024 * 1024;

    private TelegramChannelThumbnail()
    {
    }

    static TdApi.@Nullable File fileFor(TdApi.MessageContent content)
    {
        if (content instanceof TdApi.MessagePhoto value && value.photo.sizes != null)
        {
            return Arrays.stream(value.photo.sizes)
                    .filter(size -> size.photo != null && size.photo.id > 0 && Math.max(size.width, size.height) <= 1280
                            && size.photo.size <= MAX_BYTES && size.photo.expectedSize <= MAX_BYTES)
                    .min(Comparator.comparingInt(size -> Math.abs(Math.max(size.width, size.height) - 480)))
                    .map(size -> size.photo).orElse(null);
        }
        TdApi.Thumbnail thumbnail = switch (content)
        {
            case TdApi.MessageVideo value -> value.video.thumbnail;
            case TdApi.MessageDocument value -> value.document.thumbnail;
            case TdApi.MessageAnimation value -> value.animation.thumbnail;
            case TdApi.MessageAudio value -> value.audio.albumCoverThumbnail;
            default -> null;
        };
        if (thumbnail == null || thumbnail.file == null || thumbnail.file.id <= 0 || thumbnail.file.size > MAX_BYTES
                || thumbnail.file.expectedSize > MAX_BYTES)
        {
            return null;
        }
        return thumbnail.format instanceof TdApi.ThumbnailFormatJpeg
                || thumbnail.format instanceof TdApi.ThumbnailFormatPng
                || thumbnail.format instanceof TdApi.ThumbnailFormatWebp ? thumbnail.file : null;
    }

    static byte @Nullable [] embedded(TdApi.MessageContent content)
    {
        TdApi.Minithumbnail mini = switch (content)
        {
            case TdApi.MessagePhoto value -> value.photo.minithumbnail;
            case TdApi.MessageVideo value -> value.video.minithumbnail;
            case TdApi.MessageDocument value -> value.document.minithumbnail;
            case TdApi.MessageAnimation value -> value.animation.minithumbnail;
            case TdApi.MessageAudio value -> value.audio.albumCoverMinithumbnail;
            default -> null;
        };
        return mini != null && mini.data != null && mini.data.length <= 65536 ? mini.data : null;
    }

    static boolean available(TdApi.MessageContent content)
    {
        return fileFor(content) != null || embedded(content) != null;
    }

    static String contentType(byte[] bytes)
    {
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255)
        {
            return "image/jpeg";
        }
        if (bytes.length >= 8 && bytes[0] == (byte) 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71)
        {
            return "image/png";
        }
        if (bytes.length >= 12 && bytes[0] == 82 && bytes[1] == 73 && bytes[2] == 70 && bytes[3] == 70 && bytes[8] == 87
                && bytes[9] == 69 && bytes[10] == 66 && bytes[11] == 80)
        {
            return "image/webp";
        }
        throw new com.mayday.common.exception.BusinessException("缩略图格式暂不支持，请打开原媒体预览");
    }
}
