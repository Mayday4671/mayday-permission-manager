package com.mayday.content;

import java.util.HashSet;
import java.util.Set;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 正文修订只新增不覆盖；审批结果仅修改授权状态，不能替换已审正文。分类/标签通过稳定 ID 关联。
 *
 * <p>
 * 标签与附件是 cms_revision_tag / cms_revision_file 关联表，标记为非列并由仓储读取时装配、保存时重建；
 * 分类与栏目只保留稳定 ID，联表展示由查询显式完成。
 */
@Getter
@Setter
@Table(value = "cms_revision", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class ContentRevision extends BaseEntity
{
    private Long noticeId;

    private int revisionNumber;

    private String title;

    private Long categoryId;

    /** 栏目归属随修订冻结，不由分类名称或前端路由推断；旧修订由升级迁移补齐。 */
    private Long portalChannelId;

    private String summary;

    private String content;

    private String visibility = "PUBLIC";

    /** 封面和附件仅保存授权文件 ID，展示时仍按当前内容版本重新验证关联。 */
    private Long coverId;

    private int sortOrder;
    private boolean pinned;
    private boolean recommended;

    private String seoTitle;

    private String seoKeywords;

    private String seoDescription;

    private String approvalStatus = "DRAFT";

    /** 审批绑定此修订编号，旧审批结果不能授权后来产生的新修订。 */
    private Long approvalRequestId;

    private Long editorId;

    private String editorName;

    @Column(ignore = true)
    private Set<Long> tagIds = new HashSet<>();

    @Column(ignore = true)
    private Set<Long> attachmentIds = new HashSet<>();
}
