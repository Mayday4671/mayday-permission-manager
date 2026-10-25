package com.mayday.telegram;

import java.util.ArrayList;
import java.util.List;

import it.tdlight.jni.TdApi;

/** A source rendition with an internal session-bound file handle. */
public record TelegramVideoQuality(String id, int width, int height, String codec, long size, int fileId) {
    /** Public selection metadata deliberately excludes native file identifiers. */
    public record VideoQualityView(String id, int width, int height, String codec, long size) {
    }

    /**
     * Returns only safe metadata; clients select renditions by source-specific IDs.
     */
    public VideoQualityView view()
    {
        return new VideoQualityView(id, width, height, codec, size);
    }

    /**
     * Reads only renditions Telegram actually supplied, without synthesizing
     * quality levels.
     */
    static List<TelegramVideoQuality> from(TdApi.MessageContent content)
    {
        if (!(content instanceof TdApi.MessageVideo message) || message.video == null || message.video.video == null)
        {
            return List.of();
        }
        List<TelegramVideoQuality> qualities = new ArrayList<>();
        TdApi.Video original = message.video;
        if (original.video.id > 0)
        {
            qualities.add(new TelegramVideoQuality("original", original.width, original.height, "",
                    Math.max(original.video.size, original.video.expectedSize), original.video.id));
        }
        if (message.alternativeVideos != null)
        {
            for (TdApi.AlternativeVideo variant : message.alternativeVideos)
            {
                if (variant == null || variant.video == null || variant.video.id <= 0 || variant.width <= 0
                        || variant.height <= 0)
                {
                    continue;
                }
                String id = "alt:" + variant.id;
                if (qualities.stream().anyMatch(quality -> quality.id().equals(id)))
                {
                    continue;
                }
                qualities.add(new TelegramVideoQuality(id, variant.width, variant.height,
                        variant.codec == null ? "" : variant.codec,
                        Math.max(variant.video.size, variant.video.expectedSize), variant.video.id));
            }
        }
        return List.copyOf(qualities);
    }
}
