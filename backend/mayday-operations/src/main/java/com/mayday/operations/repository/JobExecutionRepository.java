package com.mayday.operations.repository;

import com.mayday.operations.model.JobExecution;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 执行历史不依赖配置生命周期，失败提醒重试的查询限制数量与时间，避免全表轮询。 */
public interface JobExecutionRepository
    extends JpaRepository<JobExecution, Long>, JpaSpecificationExecutor<JobExecution> {
  /** 每批扫描最早100条尚未完成提醒的近期失败，已投递条目退出队列，避免旧记录永久饥饿。 */
  List<JobExecution> findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
      String status, LocalDateTime after);

  /** 提醒投递与完成标记共用执行记录行锁，多实例不能同时领取同一失败提醒。 */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select execution from JobExecution execution where execution.id = :id")
  Optional<JobExecution> lock(Long id);
}
