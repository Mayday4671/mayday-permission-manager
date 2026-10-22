package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramVideoPreview;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** MyBatis-Flex 任务队列访问；数据库行锁保证多实例不会重复领取同一视频。 */
@Mapper
public interface TelegramVideoPreviewMapper extends EntityMapper<TelegramVideoPreview>
{
    /** 以短事务锁定指定视频的预览任务，序列化重复创建、重试与取消请求。 */
    default Optional<TelegramVideoPreview> lockByMediaId(Long mediaId)
    {
        return Optional.ofNullable(
                selectOneByQuery(QueryWrapper.create().where(new QueryColumn("media_id").eq(mediaId)).forUpdate()));
    }

    /**
     * Reads one task without acquiring a write lock for status and media requests.
     */
    default Optional<TelegramVideoPreview> findByMediaId(Long mediaId)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("media_id").eq(mediaId))));
    }

    /** 锁定一个可执行任务或租约已过期任务，实例间使用 SKIP LOCKED 分配队列。 */
    @Select("""
            SELECT *
            FROM biz_telegram_video_preview
            WHERE (status = 'QUEUED' AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP(6)))
               OR (status = 'PROCESSING' AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP(6)))
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """)
    TelegramVideoPreview lockNext();

    /** 锁定固定预算行，使总空间聚合检查在并发创建预览时保持串行。 */
    @Select("SELECT id FROM biz_telegram_video_preview_budget WHERE id = 1 FOR UPDATE")
    Integer lockBudget();

    /** 记录最近完成的预算核验，实体映射不存在用户可写入口。 */
    @Update("UPDATE biz_telegram_video_preview_budget SET updated_at = CURRENT_TIMESTAMP(6) WHERE id = 1")
    int touchBudget();

    /** 只允许运行一个跨实例转码任务，避免多个部署节点共同耗尽 CPU 和磁盘。 */
    @Select("""
            SELECT COUNT(*)
            FROM biz_telegram_video_preview
            WHERE status = 'PROCESSING'
              AND lease_expires_at > CURRENT_TIMESTAMP(6)
            """)
    long activeProcessingCount();

    /** 锁定需要随源媒体留存到期而清理的预览，避免清理线程争抢同一任务。 */
    @Select("""
            SELECT p.*
            FROM biz_telegram_video_preview p
            JOIN biz_telegram_media m ON m.id = p.media_id
            WHERE m.status = 'EXPIRED'
              AND (p.status IN ('READY', 'FAILED', 'CANCELLED')
                   OR (p.status = 'DELETING' AND (p.lease_expires_at IS NULL
                       OR p.lease_expires_at <= CURRENT_TIMESTAMP(6))))
            ORDER BY p.updated_at ASC, p.id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """)
    TelegramVideoPreview lockExpired();

    /** 保守统计可用与队列中预览占用的文件空间，供模块级配额决策使用。 */
    @Select("""
            SELECT COALESCE(SUM(CASE WHEN p.status IN ('READY', 'DELETING')
                THEN COALESCE(a.actual_size, 0) ELSE p.reserved_bytes END), 0)
            FROM biz_telegram_video_preview p
            LEFT JOIN biz_telegram_video_preview_asset a ON a.preview_id = p.id
            WHERE p.status IN ('QUEUED', 'PROCESSING', 'READY', 'DELETING')
            """)
    long reservedStorageBytes();
}
