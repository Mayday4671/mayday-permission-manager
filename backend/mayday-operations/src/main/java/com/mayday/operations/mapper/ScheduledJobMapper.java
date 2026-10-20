package com.mayday.operations.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.operations.model.ScheduledJob;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 定时任务只能绑定预注册处理器；禁止任意 URL、脚本和 Java 类名作为执行入口。 */
@Mapper
public interface ScheduledJobMapper extends EntityMapper<ScheduledJob> {
  default Optional<ScheduledJob> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  default List<ScheduledJob> findByEnabledTrueAndNextRunAtLessThanEqual(LocalDateTime now) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("enabled").eq(true))
            .and(new QueryColumn("next_run_at").le(now)));
  }
}
