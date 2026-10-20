package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 站内信按收件人独立保存已读状态；发件人与接收者均由服务端校验。 */
@Getter
@Setter
@Table(
    value = "ops_message",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class MessageRecord extends BaseEntity {
  private String title;

  private String content;

  private Long senderId;

  private String senderName;

  private Long recipientId;

  private java.time.LocalDateTime readAt;
}
