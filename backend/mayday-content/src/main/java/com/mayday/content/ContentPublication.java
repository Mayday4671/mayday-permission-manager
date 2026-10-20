package com.mayday.content;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 发布历史记录实际开始与结束时间；定时下线和人工下线走同一服务，不能留下两个同时有效的发布。 */
@Getter
@Setter
@Table(value = "cms_publication", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class ContentPublication extends BaseEntity
{
    /** 发布历史引用当时实际使用的修订，后续草稿修改不会覆盖这条历史。 */
    private Long noticeId;

    /** 实际发布的修订 ID，外键 cms_revision.id */
    private Long revisionId;

    /** 本次上线时间，北京时间；不是修订创建时间 */
    private LocalDateTime publishedAt;

    /** null 代表尚未结束；实际公开与否还须结合主记录回收、发布时间和可见范围判断。 */
    private LocalDateTime offlineAt;

    /** 发布或下线操作人显示名快照 */
    private String operatorName;

    /** 发布/下线原因或来源，例如手动操作、定时发布、旧版迁移 */
    private String reason;
}
