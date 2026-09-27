package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 执行历史独立留存，删除任务不会抹掉执行日志。 */
@Getter
@Setter
@Entity
@Table(name = "ops_job_execution")
public class JobExecution extends BaseEntity {
  private Long jobId;

  @Column(length = 100)
  private String jobName;

  @Column(length = 16)
  private String status;

  @Column(length = 1000)
  private String result;

  private long durationMs;
}
