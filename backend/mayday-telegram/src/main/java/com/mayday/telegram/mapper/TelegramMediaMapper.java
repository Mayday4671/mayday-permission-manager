package com.mayday.telegram.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramMedia;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
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

    /**
     * Counts stored objects and conservatively reserves the configured maximum for
     * every active download, so concurrent workers cannot overbook the module
     * quota.
     */
    @Select("SELECT COALESCE(SUM(CASE " + "WHEN status IN ('AVAILABLE', 'DELETING') THEN COALESCE(actual_size, 0) "
            + "WHEN status IN ('QUEUED', 'DOWNLOADING') THEN "
            + "CASE WHEN status = 'DOWNLOADING' OR COALESCE(expected_size, 0) = 0 "
            + "THEN #{maxFileBytes} ELSE LEAST(expected_size, #{maxFileBytes}) END "
            + "ELSE 0 END), 0) FROM biz_telegram_media "
            + "WHERE status IN ('AVAILABLE', 'DELETING', 'QUEUED', 'DOWNLOADING')")
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
