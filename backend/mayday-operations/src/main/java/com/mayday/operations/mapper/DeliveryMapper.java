package com.mayday.operations.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.Delivery;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import org.apache.ibatis.annotations.Mapper;

/** 已读更新在 SQL 内附带收件人和未读条件，重复请求与并发请求均不会覆盖第一次阅读时间。 */
@Mapper
public interface DeliveryMapper extends EntityMapper<Delivery>
{
    /** 撤回后只发送缓存失效事件，不发送通知正文。 */
    default List<Delivery> findByNotificationId(Long notificationId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("notification_id").eq(notificationId)));
    }

    default long countByNotificationId(Long notificationId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("notification_id").eq(notificationId)));
    }

    default long countByNotificationIdAndReadAtIsNotNull(Long notificationId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("notification_id").eq(notificationId))
                .and(new QueryColumn("read_at").isNotNull()));
    }

    /** 点对点已读与乐观锁版本递增同语句完成，条件不满足时影响行数为 0。 */
    default int markRead(Long id, Long userId, LocalDateTime now)
    {
        return Db.updateBySql("update ops_delivery set read_at = ?, updated_at = ?, version = version + 1"
                + " where id = ? and recipient_id = ? and read_at is null", now, now, id, userId);
    }

    /** 全部已读仍以收件人与未读为条件，且只覆盖仍然发布且未过期的通知。 */
    default int markAllRead(Long userId, LocalDateTime now)
    {
        return Db.updateBySql("update ops_delivery d set d.read_at = ?, d.updated_at = ?, d.version = d.version + 1"
                + " where d.recipient_id = ? and d.read_at is null and d.notification_id in"
                + " (select n.id from ops_notification n where n.status = 'PUBLISHED'"
                + " and (n.expires_at is null or n.expires_at > ?))", now, now, userId, now);
    }

    default void deleteByNotificationId(Long notificationId)
    {
        deleteByQuery(QueryWrapper.create().where(new QueryColumn("notification_id").eq(notificationId)));
    }

    /**
     * 收件箱可见性条件：本人投递 + 通知已发布未过期 + 标题关键词（字面量转义）+ 已读状态。 详情、未读计数与列表共用，旧 URL 和缓存不构成访问授权。
     */
    default QueryWrapper visibleInbox(Boolean read, String keyword, Long recipientId, java.time.LocalDateTime now)
    {
        QueryWrapper wrapper = QueryWrapper.create().where(new QueryColumn("recipient_id").eq(recipientId));
        String exists = "exists (select 1 from ops_notification n where n.id = notification_id"
                + " and n.status = 'PUBLISHED' and (n.expires_at is null or n.expires_at > ?)"
                + " and lower(n.title) like ? escape '!')";
        String escaped = com.mayday.common.persistence.SearchPredicates.escapedLiteral(keyword);
        wrapper.and(new com.mybatisflex.core.query.RawQueryCondition(exists, now, "%" + escaped + "%"));
        if (read != null)
        {
            wrapper.and(read ? new QueryColumn("read_at").isNotNull() : new QueryColumn("read_at").isNull());
        }
        return wrapper;
    }
}
