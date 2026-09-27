package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 顺序审批模板；实例提交时复制审批人顺序，模板后续调整不会改变已有实例。 */
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
  private Long categoryId;

  @Column(nullable = false, length = 24)
  private String businessType = "GENERAL";

  @Column(columnDefinition = "longtext")
  private String draftSchema;

  private Long publishedVersionId;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "ops_flow_step", joinColumns = @JoinColumn(name = "definition_id"))
  @OrderColumn(name = "step_index")
  @Column(name = "approver_id", nullable = false)
  private java.util.List<Long> approverIds = new java.util.ArrayList<>();
}
