package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 审批实例保留申请内容和审批人快照；使用版本号防止两个决策覆盖。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_request")
public class FlowRequest extends BaseEntity {
  private Long definitionId;

  @Column(length = 100)
  private String definitionName;

  @Column(nullable = false, length = 160)
  private String title;

  @Column(nullable = false, columnDefinition = "text")
  private String content;

  private Long applicantId;

  @Column(length = 64)
  private String applicantName;

  @Column(nullable = false, length = 20)
  private String status;

  private int currentStep;
  private Long currentApproverId;
  private Long definitionVersionId;

  @Column(columnDefinition = "longtext")
  private String schemaSnapshot;

  @Column(columnDefinition = "longtext")
  private String formData;

  /** 原始提交不可修改，后续节点修正只写 formData。 */
  @Column(columnDefinition = "longtext")
  private String submittedFormData;

  @Column(columnDefinition = "longtext")
  private String resolvedAssignees;

  @Column(length = 40)
  private String currentNodeId;

  @Column(nullable = false, length = 24)
  private String businessType = "GENERAL";

  private Long businessId;
  private Long businessRevisionId;
  private java.time.LocalDateTime completedAt;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "ops_request_file", joinColumns = @JoinColumn(name = "request_id"))
  @Column(name = "file_id", nullable = false)
  private java.util.Set<Long> attachmentIds = new java.util.HashSet<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "ops_request_step", joinColumns = @JoinColumn(name = "request_id"))
  @OrderColumn(name = "step_index")
  @Column(name = "approver_id", nullable = false)
  private java.util.List<Long> approverIds = new java.util.ArrayList<>();
}
