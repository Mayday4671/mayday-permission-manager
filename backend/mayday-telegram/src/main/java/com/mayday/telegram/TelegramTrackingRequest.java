package com.mayday.telegram;

import jakarta.validation.constraints.NotNull;

/**
 * Explicitly enables or disables bounded channel history polling for one task.
 */
public record TelegramTrackingRequest(@NotNull Boolean enabled) {
}
