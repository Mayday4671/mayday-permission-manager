package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 流程定义保存可编辑草稿并指向当前发布版本；历史申请只绑定自己的发布版本和快照。 */
@Getter
@Setter
@Table(value = "ops_flow_definition", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowDefinition extends BaseEntity
{
    /** 流程名称；发起时复制为实例名称快照 */

    private String name;
    /** 唯一流程编码；业务识别使用，区别于显示名 */

    private String code;
    /** 流程用途说明 */

    private String description;
    /** 是否允许新发起；停用不改变历史版本与已存在申请的快照 */

    private boolean enabled;

    /** 审批分类编号；分类停用后禁止新发布，已有申请保留原流程信息。 */
    private Long categoryId;
    /** 业务类型：GENERAL 通用表单或 CONTENT 内容修订审核 */

    private String businessType = "GENERAL";

    /** 设计器草稿允许暂存未完成节点；保存后仍须显式发布才对新申请生效。 */
    private String draftSchema;

    /** 当前可发起的不可变版本编号，不用于修改已有审批实例。 */
    private Long publishedVersionId;

    /** 旧顺序模型兼容字段，新运行流程以 draftSchema/发布快照为准，不再按该列表重新分配。 */
    @Column(ignore = true)
    private java.util.List<Long> approverIds = new java.util.ArrayList<>();
}
