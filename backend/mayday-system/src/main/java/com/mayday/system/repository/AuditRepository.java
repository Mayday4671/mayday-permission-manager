package com.mayday.system.repository;

import com.mayday.system.model.AuditLog;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 操作元数据查询与历史清理的持久化入口；导出、清理及保留期限制由审计服务单独授权，不能直接暴露仓储。 */
public interface AuditRepository
    extends JpaRepository<AuditLog, Long>, JpaSpecificationExecutor<AuditLog> {
  /** 统计指定起点之后的操作数量，供工作台汇总；不返回请求正文或账号敏感字段。 */
  long countByCreatedAtGreaterThanEqual(LocalDateTime time);

  /** 按左闭右开时间窗口统计，避免连续日期的边界操作重复计数。 */
  long countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(LocalDateTime start, LocalDateTime end);
}
