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

  /** 同一次持久执行的稳定幂等键；内部租约令牌不通过历史接口公开。 */
  @com.fasterxml.jackson.annotation.JsonIgnore
  @Column(length = 128, unique = true)
  private String taskKey;

  /** 重启、失败恢复后的领取次数；每轮保留同一历史记录而非重复创建成功日志。 */
  private int attempts;

  /** 失败提醒已投递或接收人失效跳过的时间；为空表示待重试，成功执行不参与提醒扫描。 */
  private java.time.LocalDateTime failureNotifiedAt;
}
