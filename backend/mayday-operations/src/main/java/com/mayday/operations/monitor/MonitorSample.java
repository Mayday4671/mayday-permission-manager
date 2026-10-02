package com.mayday.operations.monitor;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 仅存运行指标的采样历史；nodeId 区分不同进程，指标不包含机器路径、业务数量或连接凭据。 */
@Entity
@Table(name = "ops_monitor_sample")
@Getter
@Setter
public class MonitorSample extends BaseEntity {
  @Column(nullable = false, length = 36)
  private String nodeId;

  private long heapUsed;
  private long heapMax;
  private double cpuUsage;
  private int threads;
  private boolean databaseHealthy;
  private long databaseLatencyMs;
}
