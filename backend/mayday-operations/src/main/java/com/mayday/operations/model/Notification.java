package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/** 一次发布只有一份不可变正文；修改已发内容必须复制成新草稿，撤回不删除阅读历史。 */
@Getter
@Setter
@Table(
    value = "ops_notification",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class Notification extends BaseEntity {
  private String title;

  private String summary;

  private String content;

  private String type = "NOTICE";

  private String status = "DRAFT";

  private String recipientType = "USERS";

  private Long senderId;

  private String senderName;

  private LocalDateTime publishedAt;
  private LocalDateTime expiresAt;
  private LocalDateTime withdrawnAt;

  /** 关联业务标签由服务端白名单生成，不存任意页面 URL；打开关联记录仍独立鉴权。 */
  private String targetType;

  private Long targetId;

  /** 系统投递唯一事件键，重复重试返回原消息；手动发布通知无需该键。 */
  private String eventKey;

  @Column(ignore = true)
  private Set<Long> recipientIds = new HashSet<>();

  @Column(ignore = true)
  private Set<Long> attachmentIds = new HashSet<>();
}
