package com.mayday.telegram;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Explicit allow-listed projection of one message from the configured bot chat.
 *
 * <p>
 * This is not Telegram's official JSON payload. Unknown message types are
 * retained by type name without a debug string.
 */
@Getter
@Setter
@Table(value = "biz_telegram_search_message", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramSearchMessage extends BaseEntity
{
    /**
     * Owner copied from the search row, so each message can be independently
     * scope-filtered.
     */
    private Long ownerId;

    /** Department copied from the search row for department-based data scopes. */
    private Long departmentId;

    /** Search relation is null for unmatched or ambiguous bot messages. */
    private Long searchId;

    /**
     * Verified private chat ID, stored as text to avoid JavaScript integer
     * precision loss.
     */
    private String botChatId;

    /**
     * Telegram message ID stored as text for precision-safe JSON and SQL mapping.
     */
    private String telegramMessageId;

    /**
     * Telegram sender user ID when sender is a user; channels and unknown senders
     * remain null.
     */
    private String senderId;

    /** Whether the message was outgoing from the authorized account. */
    private Boolean outgoing;

    /** TDLib update class that supplied the latest snapshot. */
    private String updateType;

    /** TDLib content class name, including unknown future variants. */
    private String contentType;

    /** Message text or caption; may be empty for media-only messages. */
    private String messageText;

    /**
     * JSON projection of text entities with offsets, lengths, type and safe URL
     * values.
     */
    private String entitiesJson;

    /**
     * JSON projection of inline button labels and button-specific safe metadata.
     */
    private String replyMarkupJson;

    /** Telegram message ID this reply explicitly references. */
    private String replyToMessageId;

    /** Telegram send date converted to server-local date-time for display. */
    private LocalDateTime telegramSentAt;

    /**
     * Telegram edit date converted to server-local date-time; null if never edited.
     */
    private LocalDateTime telegramEditedAt;

    /**
     * MATCHED only when Telegram supplies an explicit reply-to link; otherwise
     * UNMATCHED.
     */
    private String associationStatus;
}
