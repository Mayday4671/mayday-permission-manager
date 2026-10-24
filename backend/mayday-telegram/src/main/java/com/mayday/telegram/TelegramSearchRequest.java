package com.mayday.telegram;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Validated payload for a deliberate, single keyword send to the configured
 * bot.
 */
public record TelegramSearchRequest(@NotBlank @Size(max = 256) String keyword, Long conversationId) {
}
