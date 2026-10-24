package com.mayday.telegram;

/**
 * Resolved identifiers and the exact message returned by Telegram's link
 * lookup. Keeping the snapshot avoids a second history request, which may omit
 * the anchor for public channels not present in the account's local history.
 */
public record TelegramMessageLink(String chatId, String messageId, boolean publicMessage,
        TelegramMessageSnapshot message) {
}
