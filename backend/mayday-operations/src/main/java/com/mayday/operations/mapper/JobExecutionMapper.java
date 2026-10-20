package com.mayday.operations.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.operations.model.JobExecution;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 执行历史不依赖配置生命周期，失败提醒重试的查询限制数量与时间，避免全表轮询。 */
@Mapper
public interface JobExecutionMapper extends EntityMapper<JobExecution> {
  /** 稳定业务键下只有一份历史，重试更新同一执行而不是伪造多个成功。 */
  default Optional<JobExecution> findByTaskKey(String taskKey) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("task_key").eq(taskKey))));
  }

  /** 有界协调租约耗尽终态与业务显示，避免崩溃恢复超过上限后历史一直显示运行。 */
  default List<JobExecution> findTop100ByStatusInOrderByIdAsc(Collection<String> states) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("status").in(states))
            .orderBy("id asc")
            .limit(100));
  }

  /** 编辑与删除不能改变已领取的处理器和计划快照。 */
  default boolean existsByJobIdAndStatusIn(Long jobId, Collection<String> states) {
    return selectCountByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("job_id").eq(jobId))
                .and(new QueryColumn("status").in(states)))
        > 0;
  }

  /** 每批扫描最早100条尚未完成提醒的近期失败，已投递条目退出队列，避免旧记录永久饥饿。 */
  default List<JobExecution>
      findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
          String status, LocalDateTime after) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("status").eq(status))
            .and(new QueryColumn("failure_notified_at").isNull())
            .and(new QueryColumn("created_at").gt(after))
            .orderBy("id asc")
            .limit(100));
  }

  /** 提醒投递与完成标记共用执行记录行锁，多实例不能同时领取同一失败提醒。 */
  default Optional<JobExecution> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }
}
