package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 定时任务只能绑定预注册处理器；禁止任意 URL、脚本和 Java 类名作为执行入口。 */
@Getter
@Setter
@Entity
@Table(name = "ops_job")
public class ScheduledJob extends BaseEntity {
  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false, length = 64)
  private String handler;

  @Column(nullable = false, length = 100)
  private String cron;

  @Column(length = 500)
  private String description;

  private boolean enabled;
  private java.time.LocalDateTime nextRunAt;
}
