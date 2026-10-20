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

    /** 当前修订状态摘要：DRAFT/PENDING/APPROVED/REJECTED/PUBLISHED 等，由内容与审核服务维护 */
    private String draftStatus = "DRAFT";

    /** 是否要求修订经过审批才能发布；与系统 content.requireApproval 配置共同校验 */
    private boolean requiresApproval;

    /** 最近一次上线时间；北京时间 DATETIME，公开列表排序与展示使用 */
    private LocalDateTime publishedAt;

    /** 当前线上修订计划下线时间；NULL 表示无到期时间，公开查询同时检查时效 */
    private LocalDateTime liveOfflineAt;

    /** 排期独立引用修订，定时任务重新验证授权状态，不自动发布后续未审核的编辑内容。 */
    private Long scheduledRevisionId;

    /** 计划上线时间，北京时间；NULL 表示无待执行上线任务 */
    private LocalDateTime scheduledPublishAt;

    /** 定时发布时附带的计划下线时间；上线后转入 live_offline_at */
    private LocalDateTime scheduledOfflineAt;

    /** 设置排期的账号 ID；执行时重新检查该账号状态、发布权限和内容范围 */
    private Long scheduledActorId;

    /** 最近排期失败原因；用于后台排查，不通过门户公开 */
    private String scheduleError;

    /** 公开阅读计数；仅统计通过公开可见性检查的阅读上报，不用于权限判断 */
    private long viewCount;

    /** 软删除时间；NULL 表示不在回收站，非 NULL 禁止公开，恢复不自动重新发布 */
    private LocalDateTime deletedAt;

    /** 为旧客户端保留的标签文本快照；新客户端以修订中的稳定标签 ID 为准。 */
    @Column(ignore = true)
    private Set<String> tags = new HashSet<>();

    /** 旧版兼容标题；当前展示以 draft_revision_id 或 live_revision_id 指向的修订为准 */
    private String title;

    /** 旧版兼容分类名称；当前分类关系使用 cms_revision.category_id */
    private String category;

    /** 旧版兼容摘要；不是当前线上内容的权威来源 */
    private String summary;

    /** 旧版兼容正文；新内容正文保存在不可变 cms_revision 中 */
    private String content;

    /** 旧版兼容发布标记；公开可见性必须同时检查线上修订、删除状态、可见性及下线时间 */
    private boolean published;

    /** 作者与部门用于服务端数据范围；这些字段不允许由客户端随意替换。 */
    private Long authorId;

    /** 所属部门 ID，外键 sys_entry.id；与作者共同决定内容数据范围 */
    private Long departmentId;

    /** 作者显示名快照；保留历史，不随账号昵称自动改写 */
    private String authorName;
}
