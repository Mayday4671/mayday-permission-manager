package com.mayday.telegram;

/**
 * Verified Telegram bot chat identifiers returned by TDLib; long IDs are
 * serialized as decimal strings.
 */
public record TelegramBotChat(String chatId, String username) {
}
