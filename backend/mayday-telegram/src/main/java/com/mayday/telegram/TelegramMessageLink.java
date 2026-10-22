package com.mayday.telegram;

/**
 * Resolved identifiers returned by Telegram after validating an accessible
 * message link.
 */
public record TelegramMessageLink(String chatId, String messageId, boolean publicMessage) {
}
