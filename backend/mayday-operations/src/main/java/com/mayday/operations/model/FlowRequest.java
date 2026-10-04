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

  /** 实际提交时使用的发布版本；定义发布新版后此编号不会变化。 */
  private Long definitionVersionId;

  /** 表单、图结构、人员来源、字段授权、节点期限的不可变提交快照。 */
  @Column(columnDefinition = "longtext")
  private String schemaSnapshot;

  /** 当前表单数据，可写字段修改在决定记录中另存 before/after，原始提交另外保留。 */
  @Column(columnDefinition = "longtext")
  private String formData;

  /** 原始提交不可修改，后续节点修正只写 formData。 */
  @Column(columnDefinition = "longtext")
  private String submittedFormData;

  /** 提交时解析全部节点人员；仅实际进入的节点会建立待办和参与范围。 */
  @Column(columnDefinition = "longtext")
  private String resolvedAssignees;

  /** 管理员交接的实例级人员修复；退回重提沿用，不回退到已经离职的原发布人员。 */
  @Column(columnDefinition = "longtext")
  private String assignmentOverrides;

  @Column(length = 40)
  private String currentNodeId;

  @Column(nullable = false, length = 24)
  private String businessType = "GENERAL";

  private Long businessId;
  private Long businessRevisionId;
  private java.time.LocalDateTime completedAt;

  /** 手动催办时间由持有申请行锁的事务更新；整个申请每 30 分钟最多发送一次。 */
  private java.time.LocalDateTime lastRemindedAt;

  /** 草稿为 0；每次正式提交递增，历史任务和决定不会作为下一轮的通过凭证。 */
  private int runNumber = 1;

  /** 每次进入审批节点递增，同一节点退回重办时使用新办理批次。 */
  private int nodeVisit;

  /** 当前轮实际经过的审批节点路径；退回只允许此前经过的节点，不接受任意目标 ID。 */
  @Column(columnDefinition = "text")
  private String activePath;

  /** 首次提交或最近重提时间；草稿创建时间不冒充提交时间。 */
  private java.time.LocalDateTime submittedAt;

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
