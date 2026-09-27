package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 投递与通知同事务提交。唯一键保证一个发布批次只给每位接收者投递一次。 */
@Getter
@Setter
@Entity
@Table(name = "ops_delivery")
public class Delivery extends BaseEntity {
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "notification_id")
  private Notification notification;

  @Column(nullable = false)
  private Long recipientId;

  @Column(nullable = false, length = 64)
  private String recipientName;

  private LocalDateTime readAt;
}
