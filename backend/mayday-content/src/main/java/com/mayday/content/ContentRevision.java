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

    /** 所属内容 ID，外键 cms_notice.id；永久删除内容时级联删除修订 */
    private Long noticeId;

    /** 文章内递增修订号，与 notice_id 联合唯一；区别于 JPA version */
    private int revisionNumber;

    /** 本次修订标题；公开接口只读取线上修订标题 */
    private String title;

    /** 稳定分类 ID，外键 sys_entry.id 且 kind=categories；引用中不能删除分类 */
    private Long categoryId;

    /** 栏目归属随修订冻结，不由分类名称或前端路由推断；旧修订由升级迁移补齐。 */
    private Long portalChannelId;

    /** 内容摘要，可为空；用于列表和搜索结果展示 */
    private String summary;

    /** 经后端富文本白名单清理的 HTML 正文；前端阅读时再次过滤 */
    private String content;

    /** 可见性：PUBLIC 可公开或 INTERNAL 内部；即使有线上指针，内部修订也不能匿名读取 */
    private String visibility = "PUBLIC";

    /** 封面和附件仅保存授权文件 ID，展示时仍按当前内容版本重新验证关联。 */
    private Long coverId;

    /** 内容排序权重；门户按业务排序逻辑使用，不影响授权 */
    private int sortOrder;

    /** 置顶标记：1 在门户排序优先，但不能绕过发布或可见性检查 */
    private boolean pinned;

    /** 推荐标记：1 可被推荐筛选命中；不等于已发布 */
    private boolean recommended;

    /** 本修订 SEO 页面标题；为空时使用内容标题 */
    private String seoTitle;

    /** 本修订 SEO 关键词；作为文本元信息，不执行 HTML */
    private String seoKeywords;

    /** 本修订 SEO 描述；作为文本元信息 */
    private String seoDescription;

    /** 审批状态：DRAFT/PENDING/APPROVED/REJECTED/WITHDRAWN；状态只授权本修订，不代表已经上线 */
    private String approvalStatus = "DRAFT";

    /** 审批绑定此修订编号，旧审批结果不能授权后来产生的新修订。 */
    private Long approvalRequestId;

    /** 创建本修订的账号 ID，逻辑关联 sys_user.id；不是内容所有者字段 */
    private Long editorId;

    /** 修订编辑人昵称快照；账号后续改名不追写历史 */
    private String editorName;

    /** 修订引用的稳定标签 ID 集合（cms_revision_tag）；展示与筛选按当前授权重新校验。 */

    @Column(ignore = true)
    private Set<Long> tagIds = new HashSet<>();

    /** 修订关联的授权附件 ID 集合（cms_revision_file）；下载时仍独立鉴权。 */

    @Column(ignore = true)
    private Set<Long> attachmentIds = new HashSet<>();
}
