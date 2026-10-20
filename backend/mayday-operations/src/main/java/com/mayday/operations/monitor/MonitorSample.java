package com.mayday.operations.monitor;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 仅存运行指标的采样历史；nodeId 区分不同进程，指标不包含机器路径、业务数量或连接凭据。 */
@Getter
@Setter
@Table(
    value = "ops_monitor_sample",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class MonitorSample extends BaseEntity {
  private String nodeId;

  private long heapUsed;
  private long heapMax;
  private double cpuUsage;
  private int threads;
  private boolean databaseHealthy;
  private long databaseLatencyMs;
}
