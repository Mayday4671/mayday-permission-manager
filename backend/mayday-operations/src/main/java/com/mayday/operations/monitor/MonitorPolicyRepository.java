package com.mayday.operations.monitor;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 单例策略由迁移建立固定ID=1；不允许客户端创建多条互相冲突的策略。 */
public interface MonitorPolicyRepository extends JpaRepository<MonitorPolicy, Long> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select policy from MonitorPolicy policy where policy.id = 1")
  Optional<MonitorPolicy> lock();
}
