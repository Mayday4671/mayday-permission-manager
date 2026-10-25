package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramCollectionTask;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

/** MyBatis-Flex mapper for persisted, bounded Telegram collection tasks. */
@Mapper
public interface TelegramCollectionTaskMapper extends EntityMapper<TelegramCollectionTask>
{
    /** Serializes user controls and worker checkpoints on the same task row. */
    default Optional<TelegramCollectionTask> lock(Long id)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
    }

    /**
     * Claims one explicitly tracked, completed channel task with its own database
     * lease.
     */
    @Select("""
            SELECT *
            FROM biz_telegram_collection_task
            WHERE tracking_enabled = 1
              AND status = 'COMPLETED'
              AND (live_lease_expires_at IS NULL OR live_lease_expires_at <= CURRENT_TIMESTAMP(6))
              AND (live_checked_at IS NULL OR live_checked_at <= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 30 SECOND))
            ORDER BY COALESCE(live_checked_at, updated_at) ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """)
    // Tracking must retain owner, channel, cursor and download policy when
    // underscore mapping is disabled.
    @Results(
    {@Result(column = "owner_id", property = "ownerId"), @Result(column = "department_id", property = "departmentId"),
            @Result(column = "message_link", property = "messageLink"),
            @Result(column = "include_album", property = "includeAlbum"),
            @Result(column = "preview_only", property = "previewOnly"),
            @Result(column = "source_title", property = "sourceTitle"),
            @Result(column = "from_date", property = "fromDate"), @Result(column = "to_date", property = "toDate"),
            @Result(column = "chat_id", property = "chatId"),
            @Result(column = "cursor_message_id", property = "cursorMessageId"),
            @Result(column = "start_message_id", property = "startMessageId"),
            @Result(column = "max_messages", property = "maxMessages"),
            @Result(column = "collected_messages", property = "collectedMessages"),
            @Result(column = "scanned_messages", property = "scannedMessages"),
            @Result(column = "download_images", property = "downloadImages"),
            @Result(column = "download_videos", property = "downloadVideos"),
            @Result(column = "download_documents", property = "downloadDocuments"),
            @Result(column = "status_message", property = "statusMessage"),
            @Result(column = "lease_owner", property = "leaseOwner"),
            @Result(column = "lease_expires_at", property = "leaseExpiresAt"),
            @Result(column = "tracking_enabled", property = "trackingEnabled"),
            @Result(column = "live_cursor_message_id", property = "liveCursorMessageId"),
            @Result(column = "live_scanned_messages", property = "liveScannedMessages"),
            @Result(column = "live_checked_at", property = "liveCheckedAt"),
            @Result(column = "live_status_message", property = "liveStatusMessage"),
            @Result(column = "live_lease_owner", property = "liveLeaseOwner"),
            @Result(column = "live_lease_expires_at", property = "liveLeaseExpiresAt"),
            @Result(column = "created_at", property = "createdAt"),
            @Result(column = "updated_at", property = "updatedAt")})
    TelegramCollectionTask lockNextTracking();
}
