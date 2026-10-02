package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 每人一条待办。申请主记录行锁保护整组会签；转交保留原任务为历史，加签标记为必签。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_task")
public class FlowTask extends BaseEntity {
  private Long requestId;

  @Column(length = 40)
  private String nodeId;

  @Column(length = 80)
  private String nodeName;

  private Long assigneeId;

  @Column(length = 64)
  private String assigneeName;

  @Column(length = 20)
  private String status = "PENDING";

  private boolean mandatory;

  /** 任务属于哪个提交轮次和节点办理批次；旧任务只用于历史展示。 */
  private int runNumber = 1;

  private int nodeVisit;

  /** 抄送没有审批能力；顺签尚未轮到的任务为 WAITING，不计入个人待办。 */
  @Column(nullable = false, length = 16)
  private String kind = "APPROVAL";

  /** 仅抄送接收者能标记已读，不能修改其他接收者的阅读状态。 */
  private LocalDateTime readAt;

  private LocalDateTime decidedAt;

  /** 从申请冻结的节点超时配置推算；转交和加签继承当前节点期限，不因换人重置。 */
  private LocalDateTime dueAt;

  /** 同一任务只投递一次自动超时提醒，轮询和服务重启不会重复轰炸。 */
  private LocalDateTime timeoutNotifiedAt;
}
