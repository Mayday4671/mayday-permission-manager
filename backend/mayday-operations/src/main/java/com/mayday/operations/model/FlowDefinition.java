package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 流程定义保存可编辑草稿并指向当前发布版本；历史申请只绑定自己的发布版本和快照。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_definition")
public class FlowDefinition extends BaseEntity {
  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false, length = 64, unique = true)
  private String code;

  @Column(length = 500)
  private String description;

  private boolean enabled;

  /** 审批分类编号；分类停用后禁止新发布，已有申请保留原流程信息。 */
  private Long categoryId;

  @Column(nullable = false, length = 24)
  private String businessType = "GENERAL";

  /** 设计器草稿允许暂存未完成节点；保存后仍须显式发布才对新申请生效。 */
  @Column(columnDefinition = "longtext")
  private String draftSchema;

  /** 当前可发起的不可变版本编号，不用于修改已有审批实例。 */
  private Long publishedVersionId;

  /** 旧顺序模型兼容字段，新运行流程以 draftSchema/发布快照为准，不再按该列表重新分配。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "ops_flow_step", joinColumns = @JoinColumn(name = "definition_id"))
  @OrderColumn(name = "step_index")
  @Column(name = "approver_id", nullable = false)
  private java.util.List<Long> approverIds = new java.util.ArrayList<>();
}
