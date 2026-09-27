package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.util.*;
import lombok.Getter;
import lombok.Setter;

/** 正文修订只新增不覆盖；审批结果仅修改授权状态，不能替换已审正文。分类/标签通过稳定 ID 关联。 */
@Getter
@Setter
@Entity
@Table(name = "cms_revision")
public class ContentRevision extends BaseEntity {
  @Column(nullable = false)
  private Long noticeId;

  private int revisionNumber;

  @Column(nullable = false, length = 160)
  private String title;

  @Column(name = "category_id", nullable = false)
  private Long categoryId;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "category_id", insertable = false, updatable = false)
  private com.mayday.system.model.SystemEntry categoryEntry;

  @Column(length = 500)
  private String summary;

  @Column(nullable = false, columnDefinition = "text")
  private String content;

  @Column(nullable = false, length = 24)
  private String visibility = "PUBLIC";

  private Long coverId;
  private int sortOrder;
  private boolean pinned;
  private boolean recommended;

  @Column(length = 160)
  private String seoTitle;

  @Column(length = 250)
  private String seoKeywords;

  @Column(length = 500)
  private String seoDescription;

  @Column(nullable = false, length = 24)
  private String approvalStatus = "DRAFT";

  private Long approvalRequestId;
  private Long editorId;

  @Column(length = 64)
  private String editorName;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "cms_revision_tag", joinColumns = @JoinColumn(name = "revision_id"))
  @Column(name = "tag_id", nullable = false)
  private Set<Long> tagIds = new HashSet<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "cms_revision_file", joinColumns = @JoinColumn(name = "revision_id"))
  @Column(name = "file_id", nullable = false)
  private Set<Long> attachmentIds = new HashSet<>();
}
