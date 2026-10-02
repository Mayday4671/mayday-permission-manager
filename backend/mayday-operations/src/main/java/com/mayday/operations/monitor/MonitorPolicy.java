package com.mayday.operations.monitor;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 全站监控告警策略；使用版本号编辑，告警冷却时间在数据库锁内更新以避免多实例重复提醒。 */
@Entity
@Table(name = "ops_monitor_policy")
@Getter
@Setter
public class MonitorPolicy extends BaseEntity {
  private boolean enabled;
  private int heapThresholdPercent = 85;
  private long databaseThresholdMs = 500;
  private Long alertUserId;
  private LocalDateTime lastAlertAt;
}
