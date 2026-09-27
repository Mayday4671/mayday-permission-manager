package com.mayday.system.repository;

import com.mayday.system.model.AuditLog;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.*;

/** 日志仅提供读取接口，不提供前端删除能力。 */
public interface AuditRepository
    extends JpaRepository<AuditLog, Long>, JpaSpecificationExecutor<AuditLog> {
  long countByCreatedAtGreaterThanEqual(LocalDateTime time);

  long countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(LocalDateTime start, LocalDateTime end);
}
