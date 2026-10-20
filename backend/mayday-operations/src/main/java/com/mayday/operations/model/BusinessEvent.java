package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mayday.common.util.BusinessTime;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 事务发件箱：仅存储最小站内通知数据，不把审批表单或内容正文复制到消息里。 */
@Getter
@Setter
@Table(
    value = "ops_event",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class BusinessEvent extends BaseEntity {
  private String eventKey;

  private Long requestId;
  private Long recipientId;

  private String title;

  private String body;

  private String status = "PENDING";

  private int attempts;
  private LocalDateTime nextAttemptAt = BusinessTime.now();

  private String lastError;
}
