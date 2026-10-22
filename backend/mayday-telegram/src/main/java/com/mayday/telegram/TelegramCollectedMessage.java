package com.mayday.telegram;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Bounded, de-duplicated message projection saved by a Telegram history task.
 * Binary content is intentionally not stored in this row.
 */
@Getter
@Setter
@Table(value = "biz_telegram_collection_message", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramCollectedMessage extends BaseEntity
{
    /** Request owner copied to the message so list queries can apply SQL scope. */
    private Long ownerId;

    /** Owner department captured by the task at creation. */
    private Long departmentId;

    /** Parent task that selected this accessible Telegram history range. */
    private Long taskId;

    /** Telegram chat identifier, represented as decimal text. */
    private String chatId;

    /** Telegram message identifier, represented as decimal text. */
    private String telegramMessageId;

    /** Conversation sender user identifier, when available. */
    private String senderId;

    /** Message kind reported by the pinned TDLib API. */
    private String contentType;

    /** Plain message text or media caption; no HTML rendering is performed. */
    private String messageText;

    /**
     * Bounded JSON projection of text entities, media metadata and known file IDs.
     */
    private String metadataJson;

    /**
     * Telegram album group identifier, when the source message is part of an album.
     */
    private String albumId;

    /** Telegram topic/thread identifier when TDLib exposes one. */
    private String topicId;

    /** Whether Telegram permits saving this message's content. */
    private Boolean canBeSaved;

    /**
     * Permanent deletion is recorded as a tombstone instead of removing history.
     */
    private Boolean deleted;

    /** Original send time converted from Telegram's Unix timestamp. */
    private LocalDateTime telegramSentAt;

    /** Most recent edit time from Telegram, null for never-edited content. */
    private LocalDateTime telegramEditedAt;
}
