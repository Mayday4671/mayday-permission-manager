package com.mayday.telegram;

import java.time.LocalDateTime;

import com.mayday.common.util.BusinessTime;

/**
 * Stable HTTP views for Telegram search records and the bounded raw-message
 * viewer.
 */
public final class TelegramSearchContracts
{
    private TelegramSearchContracts()
    {
    }

    /**
     * User-visible search status; Telegram identifiers are strings to preserve
     * 64-bit precision in browsers.
     */
    public record SearchView(Long id, String keyword, String botUsername, String status, String parseStatus,
            String statusMessage, LocalDateTime createdAt, LocalDateTime expiresAt) {
        /** Converts the internal Flex entity into a non-secret response shape. */
        public static SearchView from(TelegramSearch entity)
        {
            boolean expired = entity.getExpiresAt() != null && entity.getExpiresAt().isBefore(BusinessTime.now())
                    && ("PENDING".equals(entity.getStatus()) || "SENDING".equals(entity.getStatus())
                            || "WAITING".equals(entity.getStatus()));
            return new SearchView(entity.getId(), entity.getKeyword(), entity.getBotUsername(),
                    expired ? "TIMEOUT" : entity.getStatus(), entity.getParseStatus(),
                    expired ? "等待超时；系统不会自动重发关键词" : entity.getStatusMessage(), entity.getCreatedAt(),
                    entity.getExpiresAt());
        }
    }

    /**
     * Explicit message projection; JSON fields are strings for safe display and raw
     * inspection.
     */
    public record MessageView(Long id, String telegramMessageId, String senderId, Boolean outgoing, String updateType,
            String contentType, String messageText, String entitiesJson, String replyMarkupJson,
            String replyToMessageId, LocalDateTime telegramSentAt, LocalDateTime telegramEditedAt,
            String associationStatus) {
        /**
         * Converts the allow-listed persistent projection into the browser contract.
         */
        public static MessageView from(TelegramSearchMessage entity)
        {
            return new MessageView(entity.getId(), entity.getTelegramMessageId(), entity.getSenderId(),
                    entity.getOutgoing(), entity.getUpdateType(), entity.getContentType(), entity.getMessageText(),
                    entity.getEntitiesJson(), entity.getReplyMarkupJson(), entity.getReplyToMessageId(),
                    entity.getTelegramSentAt(), entity.getTelegramEditedAt(), entity.getAssociationStatus());
        }
    }

    /**
     * A bot message plus link candidates inferred by this platform's conservative
     * parser. The original message remains available so users can verify each
     * inference.
     */
    public record ParsedMessageView(Long id, String telegramMessageId, String messageText,
            java.util.List<TelegramResultParser.SourceLink> sourceLinks, LocalDateTime telegramSentAt,
            LocalDateTime telegramEditedAt) {
        /**
         * Converts the stored message and derives candidates without fabricating
         * metadata.
         */
        public static ParsedMessageView from(TelegramSearchMessage entity, TelegramResultParser parser)
        {
            return new ParsedMessageView(entity.getId(), entity.getTelegramMessageId(), entity.getMessageText(),
                    parser.parse(entity), entity.getTelegramSentAt(), entity.getTelegramEditedAt());
        }
    }

    /**
     * One incoming bot message, conservative source candidates, and safe inline
     * text links projected from that exact message. Returning them together lets
     * the conversation renderer preserve Telegram's original text and link its
     * visible anchor ranges without mixing results from adjacent replies.
     */
    public record ConversationMessageView(Long id, String telegramMessageId, String contentType, String messageText,
            String replyMarkupJson, LocalDateTime telegramSentAt, LocalDateTime telegramEditedAt,
            String associationStatus, java.util.List<TelegramResultParser.SourceLink> sourceLinks,
            java.util.List<TelegramResultParser.InlineTextLink> inlineLinks) {

        /**
         * Builds the public projection without exposing owner, department, or bot chat
         * identifiers.
         */
        public static ConversationMessageView from(TelegramSearchMessage entity, TelegramResultParser parser)
        {
            MessageView message = MessageView.from(entity);
            return new ConversationMessageView(message.id(), message.telegramMessageId(), message.contentType(),
                    message.messageText(), message.replyMarkupJson(), message.telegramSentAt(),
                    message.telegramEditedAt(), message.associationStatus(), parser.parse(entity),
                    parser.inlineLinks(entity));
        }
    }

    /**
     * A single user keyword and its associated bot replies, presented as one
     * chronological turn inside the user's continuous bot conversation.
     */
    public record ConversationTurnView(SearchView search, java.util.List<ConversationMessageView> messages) {
    }

    /**
     * Safe callback answer returned after the user activates a stored bot button.
     */
    public record CallbackAnswerView(String text, boolean showAlert, String url) {
    }
}
