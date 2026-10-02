package com.mayday.crawler;

import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 持久队列调度入口；领取、停止和提交结果都锁同一任务，ready 查询只提供有界候选列表。 */
public interface CrawlTaskRepository
    extends JpaRepository<CrawlTask, Long>, JpaSpecificationExecutor<CrawlTask> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select t from CrawlTask t where t.id=:id")
  Optional<CrawlTask> lock(Long id);

  /** 只选择未归档且租约到期的运行任务，调用方拿锁后还须重新核对状态和当前权限。 */
  @Query(
      "select t.id from CrawlTask t where t.archived=false and t.status in ('QUEUED','RUNNING') and (t.leaseUntil is null or t.leaseUntil<:now) and (t.nextFetchAt is null or t.nextFetchAt<=:now) order by t.nextFetchAt, t.id")
  List<Long> ready(LocalDateTime now, Pageable page);

  long countByOwnerIdAndStatusInAndArchivedFalse(Long ownerId, Collection<String> states);
}
