package com.mayday.crawler.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.crawler.CrawlTask;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 持久队列调度入口；领取、停止和提交结果都锁同一任务，ready 查询只提供有界候选列表。 */
@Mapper
public interface CrawlTaskMapper extends EntityMapper<CrawlTask> {
  default Optional<CrawlTask> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  /** 只选择未归档且租约到期的运行任务，调用方拿锁后还须重新核对状态和当前权限。 */
  default List<Long> ready(LocalDateTime now, int limit) {
    return Db.selectObjectList(
            "select id from crawl_task where archived = false and status in ('QUEUED','RUNNING')"
                + " and (lease_until is null or lease_until < ?)"
                + " and (next_fetch_at is null or next_fetch_at <= ?)"
                + " order by next_fetch_at, id limit ?",
            now,
            now,
            limit)
        .stream()
        .map(value -> ((Number) value).longValue())
        .toList();
  }

  default long countByOwnerIdAndStatusInAndArchivedFalse(Long ownerId, Collection<String> states) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .and(new QueryColumn("status").in(states))
            .and(new QueryColumn("archived").eq(false)));
  }

  /** 数据库当前时间；租约与调度不依赖应用主机时钟。 */
  default java.time.LocalDateTime databaseNow() {
    return (java.time.LocalDateTime)
        com.mybatisflex.core.row.Db.selectObject("select current_timestamp(6)");
  }
}
