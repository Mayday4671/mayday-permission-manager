package com.mayday.operations.repository;

import com.mayday.operations.model.ScheduledJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 定时任务只能绑定预注册处理器；禁止任意 URL、脚本和 Java 类名作为执行入口。 数据访问层。 */
public interface ScheduledJobRepository
    extends JpaRepository<ScheduledJob, Long>, JpaSpecificationExecutor<ScheduledJob> {
  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select j from ScheduledJob j where j.id = :id")
  java.util.Optional<ScheduledJob> lock(
      @org.springframework.data.repository.query.Param("id") Long id);

  java.util.List<ScheduledJob> findByEnabledTrueAndNextRunAtLessThanEqual(
      java.time.LocalDateTime now);
}
