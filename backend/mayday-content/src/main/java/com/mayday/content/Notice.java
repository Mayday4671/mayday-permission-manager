package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/** 门户内容独立为业务模块；作者与部门用于数据权限，公开接口只读取已发布内容。 */
@Getter
@Setter
@Entity
@Table(name = "cms_notice")
public class Notice extends BaseEntity {
  /** 当前编辑修订；草稿调整不会影响正在门户展示的 liveRevisionId。 */
  private Long draftRevisionId;

  /** 已上线的不可变修订指针；没有此指针时即使 published=true 也不能公开正文。 */
  @Column(name = "live_revision_id")
  private Long liveRevisionId;

  /** 只用于查询联表；指针写入由服务层统一控制，禁止把完整修订对象作为客户端输入。 */
  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "live_revision_id", insertable = false, updatable = false)
  private ContentRevision liveRevision;

  @Column(nullable = false, length = 24)
  private String draftStatus = "DRAFT";

  private boolean requiresApproval;
  private LocalDateTime publishedAt;
  private LocalDateTime liveOfflineAt;

  /** 排期独立引用修订，定时任务重新验证授权状态，不自动发布后续未审核的编辑内容。 */
  private Long scheduledRevisionId;

  private LocalDateTime scheduledPublishAt;
  private LocalDateTime scheduledOfflineAt;
  private Long scheduledActorId;

  @Column(length = 500)
  private String scheduleError;

  private long viewCount;
  private LocalDateTime deletedAt;

  /** 为旧客户端保留的标签文本快照；新客户端以修订中的稳定标签 ID 为准。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "cms_notice_tag", joinColumns = @JoinColumn(name = "notice_id"))
  @Column(name = "tag", length = 32, nullable = false)
  private Set<String> tags = new HashSet<>();

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

  /** 作者与部门用于服务端数据范围；这些字段不允许由客户端随意替换。 */
  @Column(nullable = false)
  private Long authorId;

  private Long departmentId;

  @Column(length = 64)
  private String authorName;
}
