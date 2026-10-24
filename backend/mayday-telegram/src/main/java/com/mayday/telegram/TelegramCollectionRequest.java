package com.mayday.telegram;

import java.time.LocalDate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import org.jspecify.annotations.Nullable;

/**
 * Validated bounds and download policy for one explicitly requested history
 * task.
 *
 * <p>
 * {@code includeAlbum} defaults to false for existing callers. When true, the
 * source must be a message link without date filters; only that message's album
 * is saved and the task ends. Use a limit of 10 to allow a complete Telegram
 * album; a lower limit fails explicitly if the album contains more members.
 */
public record TelegramCollectionRequest(@Nullable @Size(max = 2048) String messageLink,
        @Nullable @Size(max = 32) String channelId, @Nullable LocalDate fromDate, @Nullable LocalDate toDate,
        @Min(1) @Max(500) int maxMessages, boolean downloadImages, boolean downloadVideos, boolean downloadDocuments,
        @Nullable Boolean includeAlbum) {
    /**
     * Older clients omit this opt-in flag; normalize absence to ordinary history.
     */
    public TelegramCollectionRequest {
        includeAlbum = Boolean.TRUE.equals(includeAlbum);
    }
}
