package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 发布历史记录实际开始与结束时间；定时下线和人工下线走同一服务，不能留下两个同时有效的发布。 */
@Getter
@Setter
@Entity
@Table(name = "cms_publication")
public class ContentPublication extends BaseEntity {
  /** 发布历史引用当时实际使用的修订，后续草稿修改不会覆盖这条历史。 */
  private Long noticeId;

  private Long revisionId;
  private LocalDateTime publishedAt;

  /** null 代表尚未结束；实际公开与否还须结合主记录回收、发布时间和可见范围判断。 */
  private LocalDateTime offlineAt;

  @Column(length = 64)
  private String operatorName;

  @Column(length = 100)
  private String reason;
}
