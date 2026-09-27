package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 发布历史记录实际开始与结束时间；定时下线和人工下线走同一服务，不能留下两个同时有效的发布。 */
@Getter
@Setter
@Entity
@Table(name = "cms_publication")
public class ContentPublication extends BaseEntity {
  private Long noticeId;
  private Long revisionId;
  private LocalDateTime publishedAt;
  private LocalDateTime offlineAt;

  @Column(length = 64)
  private String operatorName;

  @Column(length = 100)
  private String reason;
}
