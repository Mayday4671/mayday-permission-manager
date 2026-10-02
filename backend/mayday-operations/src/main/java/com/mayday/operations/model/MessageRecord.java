package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 站内信按收件人独立保存已读状态；发件人与接收者均由服务端校验。 */
@Getter
@Setter
@Entity
@Table(name = "ops_message")
public class MessageRecord extends BaseEntity {
  @Column(nullable = false, length = 160)
  private String title;

  @Column(nullable = false, columnDefinition = "text")
  private String content;

  private Long senderId;

  @Column(length = 64)
  private String senderName;

  @Column(nullable = false)
  private Long recipientId;

  private java.time.LocalDateTime readAt;
}
