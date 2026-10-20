package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 审批实例保留申请内容和审批人快照；使用版本号防止两个决策覆盖。 */
@Getter
@Setter
@Table(
    value = "ops_flow_request",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowRequest extends BaseEntity {
  private Long definitionId;

  private String definitionName;

  private String title;

  private String content;

  private Long applicantId;

  private String applicantName;

  private String status;

  private int currentStep;
  private Long currentApproverId;

  /** 实际提交时使用的发布版本；定义发布新版后此编号不会变化。 */
  private Long definitionVersionId;

  /** 表单、图结构、人员来源、字段授权、节点期限的不可变提交快照。 */
  private String schemaSnapshot;

  /** 当前表单数据，可写字段修改在决定记录中另存 before/after，原始提交另外保留。 */
  private String formData;

  /**
   * 退回申请人/撤回后尚未重新提交的私人填写 JSON（title、values）。仅申请人读取，管理员查看也只 得到最后已提交轮；保存私人稿不覆盖
   * formData，正式重提与新轮待办在同一事务中替换并清空此值。
   */
  private String privateDraft;

  /** 原始提交不可修改，后续节点修正只写 formData。 */
  private String submittedFormData;

  /** 提交时解析全部节点人员；仅实际进入的节点会建立待办和参与范围。 */
  private String resolvedAssignees;

  /** 管理员交接的实例级人员修复；退回重提沿用，不回退到已经离职的原发布人员。 */
  private String assignmentOverrides;

  /** 新编排每条支路的持久游标；旧单线实例保持空值，不被新执行语义回灌。 */
  private String executionState;

  /** 子申请只能由固定版本子流程节点建立；普通提交和编辑接口不接受这些关联字段。 */
  private Long parentRequestId;

  private String parentTokenId;

  /** 同一父子树先锁根申请，再锁具体子申请，避免父取消与子完成的反向行锁。 */
  private Long rootRequestId;

  private String currentNodeId;

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
  private String activePath;

  /** 首次提交或最近重提时间；草稿创建时间不冒充提交时间。 */
  private java.time.LocalDateTime submittedAt;

  @Column(ignore = true)
  private java.util.Set<Long> attachmentIds = new java.util.HashSet<>();

  @Column(ignore = true)
  private java.util.List<Long> approverIds = new java.util.ArrayList<>();
}
