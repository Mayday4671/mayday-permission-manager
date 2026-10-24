package com.mayday.telegram.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramMedia;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** MyBatis-Flex queries for owner-scoped Telegram binary attachment records. */
@Mapper
public interface TelegramMediaMapper extends EntityMapper<TelegramMedia>
{
    /**
     * Serializes a worker's lease-fenced state transition on a single media row.
     */
    default java.util.Optional<TelegramMedia> lock(Long id)
    {
        return java.util.Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
    }

    /** Locks the oldest available download row and any expired in-flight claim. */
    default TelegramMedia lockNext()
    {
        return selectOneByQuery(QueryWrapper.create().where(new QueryColumn("status").in("QUEUED", "DOWNLOADING"))
                .and(new com.mybatisflex.core.query.RawQueryCondition(
                        "lease_expires_at is null or lease_expires_at <= now(6)"))
                .orderBy(new QueryColumn("created_at").asc(), new QueryColumn("id").asc()).forUpdate());
    }

    /**
     * Locks one expired stored object or an abandoned deletion claim.
     *
     * <p>
     * {@code SKIP LOCKED} lets multiple Mayday instances clean different files
     * without waiting on each other. A DELETING row is reclaimed only after its
     * previous worker lease expires.
     */
    @Select("""
            SELECT *
            FROM biz_telegram_media
            WHERE (status = 'AVAILABLE' AND updated_at <= #{expiredBefore})
               OR (status = 'DELETING' AND (lease_expires_at IS NULL
                   OR lease_expires_at <= CURRENT_TIMESTAMP(6)))
            ORDER BY updated_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """)
    // Native SQL needs explicit mappings; otherwise cleanup loses storage keys and
    // owner metadata.
    @Results(
    {@Result(column = "owner_id", property = "ownerId"), @Result(column = "department_id", property = "departmentId"),
            @Result(column = "task_id", property = "taskId"), @Result(column = "message_id", property = "messageId"),
            @Result(column = "attachment_index", property = "attachmentIndex"),
            @Result(column = "telegram_file_id", property = "telegramFileId"),
            @Result(column = "file_name", property = "fileName"),
            @Result(column = "expected_size", property = "expectedSize"),
            @Result(column = "reserved_bytes", property = "reservedBytes"),
            @Result(column = "download_ticket_hash", property = "downloadTicketHash"),
            @Result(column = "download_ticket_expires_at", property = "downloadTicketExpiresAt"),
            @Result(column = "actual_size", property = "actualSize"),
            @Result(column = "media_type", property = "mediaType"),
            @Result(column = "storage_provider", property = "storageProvider"),
            @Result(column = "storage_key", property = "storageKey"),
            @Result(column = "failure_message", property = "failureMessage"),
            @Result(column = "attempt_count", property = "attemptCount"),
            @Result(column = "lease_owner", property = "leaseOwner"),
            @Result(column = "lease_expires_at", property = "leaseExpiresAt"),
            @Result(column = "stream_ticket_hash", property = "streamTicketHash"),
            @Result(column = "stream_ticket_expires_at", property = "streamTicketExpiresAt"),
            @Result(column = "created_at", property = "createdAt"),
            @Result(column = "updated_at", property = "updatedAt")})
    TelegramMedia lockExpired(@Param("expiredBefore") LocalDateTime expiredBefore);

    /**
     * Returns all attachments associated with a message in stable display order.
     */
    default List<TelegramMedia> findForMessage(Long messageId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("message_id").eq(messageId))
                .orderBy(new QueryColumn("attachment_index").asc()));
    }

    /**
     * Returns files for a task so permanent task deletion can remove their objects.
     */
    default List<TelegramMedia> findForTask(Long taskId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId))
                .orderBy(new QueryColumn("id").asc()));
    }

    /** Locks all task attachments while cleanup checks their states and objects. */
    default List<TelegramMedia> lockForTask(Long taskId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId))
                .orderBy(new QueryColumn("id").asc()).forUpdate());
    }

    /** 统计任务尚未完成的附件下载，消息采集完成不代表媒体传输已经结束。 */
    default long pendingCountForTask(Long taskId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("status").in("QUEUED", "DOWNLOADING")));
    }

    /** 同一 TDLib 文件可能被多个采集任务共享，取消其中一个任务不得打断其他活跃传输。 */
    @Select("""
            SELECT COUNT(*) FROM biz_telegram_media
            WHERE telegram_file_id = #{fileId} AND id <> #{mediaId}
              AND status = 'DOWNLOADING' AND lease_expires_at > CURRENT_TIMESTAMP(6)
            """)
    long otherActiveDownloads(@Param("fileId") int fileId, @Param("mediaId") Long mediaId);

    /**
     * Serializes storage reservations across download workers and application
     * instances.
     */
    @Select("SELECT id FROM biz_telegram_video_preview_budget WHERE id = 1 FOR UPDATE")
    Long lockStorageBudget();

    /** Includes compatible-video derivatives in the shared storage budget. */
    @Select("SELECT COALESCE(SUM(CASE WHEN p.status IN ('READY', 'DELETING') "
            + "THEN COALESCE(a.actual_size, 0) ELSE p.reserved_bytes END), 0) "
            + "FROM biz_telegram_video_preview p LEFT JOIN biz_telegram_video_preview_asset a ON a.preview_id = p.id "
            + "WHERE p.status IN ('QUEUED', 'PROCESSING', 'READY', 'DELETING')")
    long previewStorageBytes();

    /**
     * Counts stored bytes and immutable active reservations; queued files reserve
     * nothing.
     */
    @Select("SELECT COALESCE(SUM(CASE WHEN status IN ('AVAILABLE', 'DELETING') "
            + "THEN COALESCE(actual_size, 0) ELSE COALESCE(reserved_bytes, #{maxFileBytes}) END), 0) "
            + "FROM biz_telegram_media WHERE status IN ('AVAILABLE', 'DELETING', 'DOWNLOADING')")
    long reservedStorageBytes(@Param("maxFileBytes") long maxFileBytes);

    /**
     * Stops queued media work after its parent collection is cancelled. In-flight
     * rows keep their lease so their worker can safely discard its result.
     */
    @Update("UPDATE biz_telegram_media SET status = 'FAILED', failure_message = '来源采集任务已取消', "
            + "lease_owner = NULL, lease_expires_at = NULL, version = version + 1, "
            + "updated_at = CURRENT_TIMESTAMP(6) WHERE task_id = #{taskId} AND status = 'QUEUED'")
    int cancelQueuedForTask(@Param("taskId") Long taskId);
}
