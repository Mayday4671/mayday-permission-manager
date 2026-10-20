package com.mayday.operations.monitor;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 全站监控告警策略；使用版本号编辑，告警冷却时间在数据库锁内更新以避免多实例重复提醒。 */
@Getter
@Setter
@Table(
    value = "ops_monitor_policy",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class MonitorPolicy extends BaseEntity {
  private boolean enabled;
  private int heapThresholdPercent = 85;
  private long databaseThresholdMs = 500;
  private Long alertUserId;
  private LocalDateTime lastAlertAt;
}
