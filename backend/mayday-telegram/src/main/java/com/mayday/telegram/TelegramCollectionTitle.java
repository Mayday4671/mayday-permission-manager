package com.mayday.telegram;

import java.util.List;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.ObjectMapper;

/** Derives a concise display title from authorized, saved message content. */
final class TelegramCollectionTitle
{
    private static final int MAX_TITLE_CODE_POINTS = 160;
    private static final ObjectMapper JSON = new ObjectMapper();

    private TelegramCollectionTitle()
    {
    }

    /**
     * Prefers an original caption, then an album caption, then an attachment
     * filename.
     */
    static @Nullable String from(List<TelegramCollectedMessage> candidates)
    {
        List<TelegramCollectedMessage> readable = candidates.stream()
                .filter(item -> Boolean.TRUE.equals(item.getCanBeSaved())).toList();
        for (TelegramCollectedMessage item : readable)
        {
            String title = compact(item.getMessageText());
            if (title != null)
            {
                return title;
            }
        }
        for (TelegramCollectedMessage item : readable)
        {
            if (item.getMetadataJson() == null || item.getMetadataJson().isBlank())
            {
                continue;
            }
            try
            {
                var metadata = JSON.readTree(item.getMetadataJson());
                if (metadata == null || !metadata.isArray())
                {
                    continue;
                }
                for (var attachment : metadata)
                {
                    var fileName = attachment.get("fileName");
                    String title = fileName != null && fileName.isString() ? compact(fileName.stringValue()) : null;
                    if (title != null)
                    {
                        return title;
                    }
                }
            } catch (tools.jackson.core.JacksonException exception)
            {
                // Old malformed metadata must not prevent the task list from loading.
                continue;
            }
        }
        return null;
    }

    private static @Nullable String compact(@Nullable String value)
    {
        if (value == null || value.isBlank())
        {
            return null;
        }
        String title = value.lines().map(String::strip).filter(line -> !line.isBlank()).findFirst().orElse("")
                .replaceAll("\\s+", " ");
        if (title.codePointCount(0, title.length()) > MAX_TITLE_CODE_POINTS)
        {
            return title.substring(0, title.offsetByCodePoints(0, MAX_TITLE_CODE_POINTS)) + "…";
        }
        return title.isBlank() ? null : title;
    }
}
