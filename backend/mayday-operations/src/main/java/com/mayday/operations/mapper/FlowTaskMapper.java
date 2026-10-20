package com.mayday.operations.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowTask;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import org.apache.ibatis.annotations.Mapper;

/** 每人任务属于一个冻结节点；查询个人待办和到期任务后仍须在申请行锁内重新校验状态。 */
@Mapper
public interface FlowTaskMapper extends EntityMapper<FlowTask>
{
    default List<FlowTask> findByRequestIdOrderByIdAsc(Long requestId)
    {
        return selectListByQuery(
                QueryWrapper.create().where(new QueryColumn("request_id").eq(requestId)).orderBy("id asc"));
    }

    default boolean existsByRequestIdAndAssigneeId(Long requestId, Long assigneeId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("request_id").eq(requestId))
                .and(new QueryColumn("assignee_id").eq(assigneeId))) > 0;
    }

    default void deleteByRequestId(Long requestId)
    {
        deleteByQuery(QueryWrapper.create().where(new QueryColumn("request_id").eq(requestId)));
    }

    /** 限量扫描尚未提醒的到期任务；真正投递前还要在申请行锁内重新确认节点状态。 */
    default List<Long> due(LocalDateTime now, int limit)
    {
        return Db
                .selectObjectList("select id from ops_flow_task where status = 'PENDING' and due_at <= ?"
                        + " and timeout_notified_at is null order by due_at, id limit ?", now, limit)
                .stream().map(value -> ((Number) value).longValue()).toList();
    }
}
