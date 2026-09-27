package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.*;
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

  @Column(nullable = false, columnDefinition = "text")
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

  @Column(length = 24)
  private String targetType;

  private Long targetId;

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
