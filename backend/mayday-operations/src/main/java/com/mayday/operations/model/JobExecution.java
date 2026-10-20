package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/** 执行历史独立留存，删除任务不会抹掉执行日志。 */
@Getter
@Setter
@Schema(requiredProperties =
{"id", "version", "jobId", "jobName", "status", "result", "durationMs", "createdAt"})
@Table(value = "ops_job_execution", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class JobExecution extends BaseEntity
{
    /** 任务 ID，逻辑关联 ops_job.id；任务删除后历史可保留 */

    private Long jobId;
    /** 执行时任务名称快照 */

    private String jobName;
    /** 执行结果状态：SUCCESS成功、FAILED失败；失败结果独立于业务事务保存，不能将请求成功等同于任务成功 */

    private String status;
    /** 脱敏的运行结果说明；不得包含密码、令牌或未经授权的业务聚合数据 */

    private String result;
    /** 处理器耗时，单位毫秒 */

    private long durationMs;

    /** 同一次持久执行的稳定幂等键；内部租约令牌不通过历史接口公开。 */
    @com.fasterxml.jackson.annotation.JsonIgnore
    private String taskKey;

    /** 重启、失败恢复后的领取次数；每轮保留同一历史记录而非重复创建成功日志。 */
    private int attempts;

    /** 失败提醒已投递或接收人失效跳过的时间；为空表示待重试，成功执行不参与提醒扫描。 */
    private java.time.LocalDateTime failureNotifiedAt;
}
