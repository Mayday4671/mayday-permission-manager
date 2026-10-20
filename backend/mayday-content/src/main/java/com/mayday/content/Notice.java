package com.mayday.content;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户内容独立为业务模块；作者与部门用于数据权限，公开接口只读取已发布内容。
 *
 * <p>
 * 标签快照存于 cms_notice_tag 关联表，标记为非列并由仓储读取时装配、保存时重建；正文指针只存稳定修订 ID。
 */
@Getter
@Setter
@Table(value = "cms_notice", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class Notice extends BaseEntity
{
    /** 当前编辑修订；草稿调整不会影响正在门户展示的 liveRevisionId。 */
    private Long draftRevisionId;

    /** 已上线的不可变修订指针；没有此指针时即使 published=true 也不能公开正文。 */
    private Long liveRevisionId;

    private String draftStatus = "DRAFT";

    private boolean requiresApproval;
    private LocalDateTime publishedAt;
    private LocalDateTime liveOfflineAt;

    /** 排期独立引用修订，定时任务重新验证授权状态，不自动发布后续未审核的编辑内容。 */
    private Long scheduledRevisionId;

    private LocalDateTime scheduledPublishAt;
    private LocalDateTime scheduledOfflineAt;
    private Long scheduledActorId;

    private String scheduleError;

    private long viewCount;
    private LocalDateTime deletedAt;

    /** 为旧客户端保留的标签文本快照；新客户端以修订中的稳定标签 ID 为准。 */
    @Column(ignore = true)
    private Set<String> tags = new HashSet<>();

    private String title;

    private String category;

    private String summary;

    private String content;

    private boolean published;

    /** 作者与部门用于服务端数据范围；这些字段不允许由客户端随意替换。 */
    private Long authorId;

    private Long departmentId;

    private String authorName;
}
