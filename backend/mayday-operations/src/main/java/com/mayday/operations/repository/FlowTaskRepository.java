package com.mayday.operations.repository;

import com.mayday.operations.model.FlowTask;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

/** 每人任务属于一个冻结节点；查询个人待办和到期任务后仍须在申请行锁内重新校验状态。 */
public interface FlowTaskRepository
    extends JpaRepository<FlowTask, Long>, JpaSpecificationExecutor<FlowTask> {
  List<FlowTask> findByRequestIdOrderByIdAsc(Long requestId);

  boolean existsByRequestIdAndAssigneeId(Long requestId, Long assigneeId);

  void deleteByRequestId(Long requestId);

  /** 限量扫描尚未提醒的到期任务；真正投递前还要在申请行锁内重新确认节点状态。 */
  @Query(
      "select t.id from FlowTask t where t.status='PENDING' and t.dueAt<=:now and t.timeoutNotifiedAt is null order by t.dueAt,t.id")
  List<Long> due(java.time.LocalDateTime now, org.springframework.data.domain.Pageable page);
}
