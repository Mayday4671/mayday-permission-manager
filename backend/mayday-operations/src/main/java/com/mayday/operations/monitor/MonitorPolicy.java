package com.mayday.operations.monitor;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 全站监控告警策略；使用版本号编辑，告警冷却时间在数据库锁内更新以避免多实例重复提醒。 */
@Getter
@Setter
@Table(value = "ops_monitor_policy", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class MonitorPolicy extends BaseEntity
{

    /** 是否启用站内阈值告警；默认关闭，监控采样仍继续 */
    private boolean enabled;

    /** 堆内存告警使用率阈值，单位百分比，允许50至99，默认85 */
    private int heapThresholdPercent = 85;

    /** 数据库连接验证延迟阈值，单位毫秒，允许10至60000，默认500 */
    private long databaseThresholdMs = 500;

    /** 告警接收账号ID；开启告警必须设置且具有监控查看权，不公开外部联系方式 */
    private Long alertUserId;

    /** 最近告警时间；数据库行锁内更新，同一策略30分钟最多提醒一次 */
    private LocalDateTime lastAlertAt;
}
