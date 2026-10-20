package com.mayday.operations.monitor.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.monitor.MonitorSample;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 历史按时间范围和节点查询；有限条数的服务端采样聚合避免向页面一次发送全部历史。 */
@Mapper
public interface MonitorSampleMapper extends EntityMapper<MonitorSample> {
  default List<MonitorSample> findByNodeIdAndCreatedAtGreaterThanEqualOrderByIdDesc(
      String nodeId, LocalDateTime since, int limit) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("node_id").eq(nodeId))
            .and(new QueryColumn("created_at").ge(since))
            .orderBy("id desc")
            .limit(limit));
  }

  default void deleteByCreatedAtBefore(LocalDateTime before) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("created_at").lt(before)));
  }
}
