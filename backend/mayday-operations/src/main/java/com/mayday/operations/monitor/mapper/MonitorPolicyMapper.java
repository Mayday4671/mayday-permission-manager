package com.mayday.operations.monitor.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.operations.monitor.MonitorPolicy;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 单例策略由迁移建立固定ID=1；不允许客户端创建多条互相冲突的策略。 */
@Mapper
public interface MonitorPolicyMapper extends EntityMapper<MonitorPolicy> {
  default Optional<MonitorPolicy> lock() {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(1L)).forUpdate()));
  }
}
