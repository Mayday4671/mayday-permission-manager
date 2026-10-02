package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 事务发件箱：仅存储最小站内通知数据，不把审批表单或内容正文复制到消息里。 */
@Getter
@Setter
@Entity
@Table(name = "ops_event")
public class BusinessEvent extends BaseEntity {
  @Column(length = 160, unique = true)
  private String eventKey;

  private Long requestId;
  private Long recipientId;

  @Column(length = 160)
  private String title;

  @Column(length = 1000)
  private String body;

  @Column(length = 16)
  private String status = "PENDING";

  private int attempts;
  private LocalDateTime nextAttemptAt = LocalDateTime.now();

  @Column(length = 500)
  private String lastError;
}
