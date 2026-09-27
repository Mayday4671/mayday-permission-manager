package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 审批历史只追加，申请人和审批参与人可查询。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_decision")
public class FlowDecision extends BaseEntity {
  private Long requestId;

  /** 字段改动只在服务层按查看人的字段范围过滤后返回，禁止直接序列化实体。 */
  @Column(columnDefinition = "longtext")
  private String changesJson;

  private Long actorId;

  @Column(length = 64)
  private String actorName;

  @Column(length = 20)
  private String action;

  @Column(length = 500)
  private String comment;

  @Column(length = 40)
  private String nodeId;

  @Column(length = 80)
  private String nodeName;

  private Long targetUserId;

  @Column(length = 64)
  private String targetUserName;
}
