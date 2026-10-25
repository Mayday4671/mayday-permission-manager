package com.mayday.telegram;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Safe media facts for channel cards; native file handles and local paths are
 * excluded.
 */
public record TelegramChannelMediaPreview(String kind, @Nullable String fileName, long size, int width, int height,
        int durationSeconds, boolean hasThumbnail) {
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Collapses alternate photo resolutions into one visible media card. */
    public static @Nullable TelegramChannelMediaPreview from(TelegramMessageSnapshot snapshot)
    {
        if (!snapshot.canBeSaved() || snapshot.attachmentMetadataJson() == null)
        {
            return null;
        }
        try
        {
            JsonNode entries = JSON.readTree(snapshot.attachmentMetadataJson());
            if (entries == null || !entries.isArray() || entries.isEmpty())
            {
                return null;
            }
            JsonNode selected = entries.get(0);
            boolean thumbnail = false;
            for (JsonNode entry : entries)
            {
                thumbnail |= entry.path("hasThumbnail").asBoolean(false);
                if ("PHOTO".equals(entry.path("kind").asText()) && entry.path("width").asLong() * entry.path("height")
                        .asLong() > selected.path("width").asLong() * selected.path("height").asLong())
                {
                    selected = entry;
                }
            }
            return new TelegramChannelMediaPreview(selected.path("kind").asText("DOCUMENT"),
                    selected.path("fileName").isTextual() ? selected.path("fileName").asText() : null,
                    Math.max(0, selected.path("expectedSize").asLong()), Math.max(0, selected.path("width").asInt()),
                    Math.max(0, selected.path("height").asInt()), Math.max(0, selected.path("durationSeconds").asInt()),
                    thumbnail);
        } catch (tools.jackson.core.JacksonException exception)
        {
            return null;
        }
    }
}
