package com.mayday.content;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 发布历史记录实际开始与结束时间；定时下线和人工下线走同一服务，不能留下两个同时有效的发布。 */
@Getter
@Setter
@Table(
    value = "cms_publication",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class ContentPublication extends BaseEntity {
  /** 发布历史引用当时实际使用的修订，后续草稿修改不会覆盖这条历史。 */
  private Long noticeId;

  private Long revisionId;
  private LocalDateTime publishedAt;

  /** null 代表尚未结束；实际公开与否还须结合主记录回收、发布时间和可见范围判断。 */
  private LocalDateTime offlineAt;

  private String operatorName;

  private String reason;
}
