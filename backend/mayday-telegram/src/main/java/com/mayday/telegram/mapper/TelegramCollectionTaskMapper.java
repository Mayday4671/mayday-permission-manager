package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramCollectionTask;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
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
    TelegramCollectionTask lockNextTracking();
}
