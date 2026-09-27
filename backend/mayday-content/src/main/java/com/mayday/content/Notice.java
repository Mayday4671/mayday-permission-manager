package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 门户内容独立为业务模块；作者与部门用于数据权限，公开接口只读取已发布内容。 */
@Getter
@Setter
@Entity
@Table(name = "cms_notice")
public class Notice extends BaseEntity {
  private Long draftRevisionId;

  @Column(name = "live_revision_id")
  private Long liveRevisionId;

  /** 只用于查询联表；指针写入由服务层统一控制，禁止把完整修订对象作为客户端输入。 */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "live_revision_id", insertable = false, updatable = false)
  private ContentRevision liveRevision;

  @Column(nullable = false, length = 24)
  private String draftStatus = "DRAFT";

  private boolean requiresApproval;
  private java.time.LocalDateTime publishedAt;
  private java.time.LocalDateTime liveOfflineAt;
  private Long scheduledRevisionId;
  private java.time.LocalDateTime scheduledPublishAt;
  private java.time.LocalDateTime scheduledOfflineAt;
  private Long scheduledActorId;

  @Column(length = 500)
  private String scheduleError;

  private long viewCount;
  private java.time.LocalDateTime deletedAt;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "cms_notice_tag", joinColumns = @JoinColumn(name = "notice_id"))
  @Column(name = "tag", length = 32, nullable = false)
  private java.util.Set<String> tags = new java.util.HashSet<>();

  @Column(nullable = false, length = 160)
  private String title;

  @Column(nullable = false, length = 32)
  private String category;

  @Column(length = 500)
  private String summary;

  @Column(nullable = false, columnDefinition = "text")
  private String content;

  @Column(nullable = false)
  private boolean published;

  @Column(nullable = false)
  private Long authorId;

  private Long departmentId;

  @Column(length = 64)
  private String authorName;
}
