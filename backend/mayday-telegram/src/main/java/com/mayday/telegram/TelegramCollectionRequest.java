package com.mayday.telegram;

import java.time.LocalDate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import org.jspecify.annotations.Nullable;

/**
 * Validated bounds and download policy for one explicitly requested history
 * task.
 */
public record TelegramCollectionRequest(@Nullable @Size(max = 2048) String messageLink,
        @Nullable @Size(max = 32) String channelId, @Nullable LocalDate fromDate, @Nullable LocalDate toDate,
        @Min(1) @Max(500) int maxMessages, boolean downloadImages, boolean downloadVideos, boolean downloadDocuments) {
}
