package com.mayday.operations.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.operations.model.BusinessEvent;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 已提交审批消息的持久队列；领取锁和唯一键共同保证多次重试只生成一条投递。 */
@Mapper
public interface BusinessEventMapper extends EntityMapper<BusinessEvent> {
  /** 只取有界候选，领取时逐条加锁并复核状态。 */
  default List<Long> due(LocalDateTime now, int limit) {
    return Db.selectObjectList(
            "select id from ops_event where status = 'PENDING' and next_attempt_at <= ?"
                + " order by id limit ?",
            now,
            limit)
        .stream()
        .map(value -> ((Number) value).longValue())
        .toList();
  }

  default Optional<BusinessEvent> lockById(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  default boolean existsByEventKey(String eventKey) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("event_key").eq(eventKey)))
        > 0;
  }

  default List<BusinessEvent> findByRequestIdOrderByIdDesc(Long requestId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("request_id").eq(requestId))
            .orderBy("id desc"));
  }

  default void deleteByRequestId(Long requestId) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("request_id").eq(requestId)));
  }
}
