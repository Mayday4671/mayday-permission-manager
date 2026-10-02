package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 定时任务只能绑定预注册处理器；禁止任意 URL、脚本和 Java 类名作为执行入口。 */
@Getter
@Setter
@Entity
@Table(name = "ops_job")
@Schema(requiredProperties = {"id", "version", "name", "handler", "cron", "enabled", "createdAt"})
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

  /** 失败提醒接收人；只选择有调度查看权限的有效账号，空值不发送提醒。 */
  private Long alertUserId;
}
