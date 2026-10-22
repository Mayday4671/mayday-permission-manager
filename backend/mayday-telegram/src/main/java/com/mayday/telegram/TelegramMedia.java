package com.mayday.telegram;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Owner-scoped Telegram attachment download and durable storage reference.
 * TDLib file IDs stay server-side because they are tied to one local session.
 */
@Getter
@Setter
@Table(value = "biz_telegram_media", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramMedia extends BaseEntity
{
    /** Mayday account allowed to view or download this file. */
    private Long ownerId;

    /** Owner department captured when the source task was created. */
    private Long departmentId;

    /** Parent bounded history task. */
    private Long taskId;

    /** Local row for the Telegram message that contained this attachment. */
    private Long messageId;

    /** Stable zero-based attachment position within the source message snapshot. */
    private Integer attachmentIndex;

    /** Session-bound TDLib file handle; never serialized into browser DTOs. */
    private Integer telegramFileId;

    /** Allow-listed attachment kind used to enforce the task's download policy. */
    private String kind;

    /** Untrusted source filename retained only as display metadata. */
    private String fileName;

    /**
     * TDLib's estimated byte count, which is checked against the configured limit.
     */
    private Long expectedSize;

    /** Actual byte count after the complete object is written to shared storage. */
    private Long actualSize;

    /**
     * Content signature detected by the server; source MIME values are not trusted.
     */
    private String mediaType;

    /** Storage backend that owns the object referenced by storageKey. */
    private String storageProvider;

    /** Server-generated opaque object key, unrelated to any supplied filename. */
    private String storageKey;

    /** Digest for checking that storage contains the bytes that TDLib returned. */
    private String sha256;

    /** QUEUED, DOWNLOADING, AVAILABLE, FAILED, DELETING, or EXPIRED. */
    private String status;

    /** Short sanitized failure state, never the original native exception text. */
    private String failureMessage;

    /** Bounded number of attempts, including explicit user retry operations. */
    private Integer attemptCount;

    /** Random token used to fence stale media workers. */
    private String leaseOwner;

    /** Deadline after which another process may safely reclaim the media row. */
    private java.time.LocalDateTime leaseExpiresAt;

    /**
     * Digest of a short-lived video capability; the raw ticket is never persisted.
     */
    private String streamTicketHash;

    /** Expiry checked on each anonymous browser Range request. */
    private java.time.LocalDateTime streamTicketExpiresAt;
}
