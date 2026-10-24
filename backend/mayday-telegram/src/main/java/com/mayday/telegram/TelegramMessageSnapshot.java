package com.mayday.telegram;

/**
 * Explicit projection of a message event needed for search review. It
 * intentionally excludes TDLib object's debug string and keeps Telegram's
 * potentially large identifiers as decimal strings.
 */
public record TelegramMessageSnapshot(String chatId, String messageId, String senderId, boolean outgoing,
        String updateType, String contentType, String text, String entitiesJson, String replyMarkupJson,
        String replyToMessageId, Long sentAtEpochSeconds, Long editedAtEpochSeconds, boolean canBeSaved, String albumId,
        String topicId, String attachmentMetadataJson, String previousMessageId, Integer sendErrorCode,
        String sendErrorName) {
}
