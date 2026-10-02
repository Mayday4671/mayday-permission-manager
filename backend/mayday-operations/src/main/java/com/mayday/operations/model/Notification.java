package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/** 一次发布只有一份不可变正文；修改已发内容必须复制成新草稿，撤回不删除阅读历史。 */
@Getter
@Setter
@Entity
@Table(name = "ops_notification")
public class Notification extends BaseEntity {
  @Column(nullable = false, length = 160)
  private String title;

  @Column(length = 500)
  private String summary;

  @Column(nullable = false, columnDefinition = "longtext")
  private String content;

  @Column(nullable = false, length = 24)
  private String type = "NOTICE";

  @Column(nullable = false, length = 24)
  private String status = "DRAFT";

  @Column(nullable = false, length = 24)
  private String recipientType = "USERS";

  private Long senderId;

  @Column(length = 64)
  private String senderName;

  private LocalDateTime publishedAt;
  private LocalDateTime expiresAt;
  private LocalDateTime withdrawnAt;

  /** 关联业务标签由服务端白名单生成，不存任意页面 URL；打开关联记录仍独立鉴权。 */
  @Column(length = 24)
  private String targetType;

  private Long targetId;

  /** 系统投递唯一事件键，重复重试返回原消息；手动发布通知无需该键。 */
  @Column(unique = true, length = 160)
  private String eventKey;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "ops_notification_target",
      joinColumns = @JoinColumn(name = "notification_id"))
  @Column(name = "target_id", nullable = false)
  private Set<Long> recipientIds = new HashSet<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "ops_notification_file",
      joinColumns = @JoinColumn(name = "notification_id"))
  @Column(name = "file_id", nullable = false)
  private Set<Long> attachmentIds = new HashSet<>();
}
