package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 执行历史独立留存，删除任务不会抹掉执行日志。 */
@Getter
@Setter
@Entity
@Table(name = "ops_job_execution")
@Schema(
    requiredProperties = {
      "id",
      "version",
      "jobId",
      "jobName",
      "status",
      "result",
      "durationMs",
      "createdAt"
    })
public class JobExecution extends BaseEntity {
  private Long jobId;

  @Column(length = 100)
  private String jobName;

  @Column(length = 16)
  private String status;

  @Column(length = 1000)
  private String result;

  private long durationMs;

  /** 失败提醒已投递或接收人失效跳过的时间；为空表示待重试，成功执行不参与提醒扫描。 */
  private java.time.LocalDateTime failureNotifiedAt;
}
