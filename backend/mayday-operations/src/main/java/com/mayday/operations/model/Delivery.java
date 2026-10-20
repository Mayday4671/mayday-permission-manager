package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 投递与通知同事务提交。唯一键保证一个发布批次只给每位接收者投递一次。 */
@Getter
@Setter
@Table(
    value = "ops_delivery",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class Delivery extends BaseEntity {
  private Long notificationId;

  private Long recipientId;

  private String recipientName;

  private LocalDateTime readAt;
}
