package com.mayday.telegram;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * A user-initiated search request sent to the configured Telegram bot.
 *
 * <p>
 * Messages are correlated only by Telegram's explicit reply-to relationship. A
 * time-window guess is not treated as a match.
 */
@Getter
@Setter
@Table(value = "biz_telegram_search", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramSearch extends BaseEntity
{
    /**
     * Mayday owner; all list and detail queries apply this resource's data scope.
     */
    private Long ownerId;

    /** Department captured at creation for role-based department scopes. */
    private Long departmentId;

    /**
     * The exact normalized keyword sent by the user; length is limited by the
     * request DTO.
     */
    private String keyword;

    /**
     * Public bot username configured by the server; the browser cannot choose an
     * arbitrary recipient.
     */
    private String botUsername;

    /** Verified Telegram private-chat identifier represented as decimal text. */
    private String botChatId;

    /** Message identifier of the outgoing query, represented as decimal text. */
    private String sentMessageId;

    /** PENDING, SENDING, WAITING, COMPLETED, TIMEOUT, FAILED, or CANCELLED. */
    private String status;

    /**
     * Parser state derived only from captured Telegram content: UNKNOWN, PARTIAL,
     * or PARSED.
     */
    private String parseStatus;

    /** Deadline after which a missing bot reply is presented as a timeout. */
    private LocalDateTime expiresAt;

    /** A fixed, non-sensitive explanation suitable for the admin interface. */
    private String statusMessage;
}
