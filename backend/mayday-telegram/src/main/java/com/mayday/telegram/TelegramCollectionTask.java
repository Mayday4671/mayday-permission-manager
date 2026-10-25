package com.mayday.telegram;

import java.time.LocalDate;
import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Persisted owner-scoped history collection request and progress checkpoint.
 *
 * <p>
 * A task starts at an explicitly supplied accessible message link or an already
 * joined channel and has hard message and history-scan limits. It never
 * silently becomes an unlimited channel crawl.
 */
@Getter
@Setter
@Table(value = "biz_telegram_collection_task", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramCollectionTask extends BaseEntity
{
    /** Mayday user who explicitly requested this collection. */
    private Long ownerId;

    /** Department captured at creation for role-based visibility checks. */
    private Long departmentId;

    /** User-supplied Telegram message link, retained as the collection source. */
    private String messageLink;

    /**
     * Explicit link-preview mode: collect only the selected message and its album,
     * then stop instead of continuing into older channel history.
     */
    private Boolean includeAlbum;

    /**
     * Preview requests keep native videos remote until the browser requests byte
     * ranges.
     */
    private Boolean previewOnly;

    /**
     * Server-verified channel title for channel-based tasks; null for link-based
     * tasks.
     */
    private String sourceTitle;

    /** Inclusive earliest business date requested by the user, if configured. */
    private LocalDate fromDate;

    /** Inclusive latest business date requested by the user, if configured. */
    private LocalDate toDate;

    /** Telegram chat ID resolved by TDLib, stored as text for 64-bit safety. */
    private String chatId;

    /** Initial accessible message and current backward-history cursor. */
    private String cursorMessageId;

    /**
     * The first message selected from the link; it anchors the bounded history
     * range.
     */
    private String startMessageId;

    /** Maximum number of unique messages this task may save. */
    private Integer maxMessages;

    /** Number of unique messages committed so far. */
    private Integer collectedMessages;

    /**
     * Number of source messages inspected, including rows excluded by date filters.
     */
    private Integer scannedMessages;

    /** QUEUED, RUNNING, PAUSED, WAITING_ACCOUNT, COMPLETED, FAILED, CANCELLED. */
    private String status;

    /** Whether a future media worker may persist image file bytes. */
    private Boolean downloadImages;

    /** Whether a future media worker may persist video file bytes. */
    private Boolean downloadVideos;

    /** Whether a future media worker may persist document file bytes. */
    private Boolean downloadDocuments;

    /**
     * Safe user-facing progress or failure text; never stores native exceptions.
     */
    private String statusMessage;

    /** Lease owner UUID used to reject stale workers after process recovery. */
    private String leaseOwner;

    /** Lease deadline; an expired RUNNING task can be claimed after restart. */
    private LocalDateTime leaseExpiresAt;

    /** Whether the user explicitly enabled bounded periodic channel catch-up. */
    private Boolean trackingEnabled;

    /** Newest message checkpoint, kept separate from the older history cursor. */
    private String liveCursorMessageId;

    /**
     * Number of messages inspected by catch-up; capped independently from backfill.
     */
    private Integer liveScannedMessages;

    /** Last time this task checked Telegram for newer channel messages. */
    private LocalDateTime liveCheckedAt;

    /** Safe status text explaining periodic polling and any stop reason. */
    private String liveStatusMessage;

    /**
     * Independent catch-up lease owner so tracking cannot overwrite a backfill
     * lease.
     */
    private String liveLeaseOwner;

    /** Catch-up lease deadline used for crash recovery. */
    private LocalDateTime liveLeaseExpiresAt;
}
