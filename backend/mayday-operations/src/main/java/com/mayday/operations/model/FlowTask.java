package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.*;

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
  private LocalDateTime decidedAt;
}
