package com.mayday.operations.monitor;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 仅存运行指标的采样历史；nodeId 区分不同进程，指标不包含机器路径、业务数量或连接凭据。 */
@Getter
@Setter
@Table(value = "ops_monitor_sample", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class MonitorSample extends BaseEntity
{

    /** 当前进程启动时生成的UUID，区分多实例采样；不是主机IP或文件路径 */
    private String nodeId;

    /** JVM已使用堆内存，单位字节，不含数据库或外部存储文件大小 */
    private long heapUsed;

    /** JVM最大堆内存，单位字节；计算使用率时必须大于0 */
    private long heapMax;

    /** 当前Java进程CPU使用率，单位百分比0至100；系统不支持时为-1，不伪造0 */
    private double cpuUsage;

    /** 当前Java进程活跃线程数，不返回线程栈或名称 */
    private int threads;

    /** 数据库连接可用性；数据库离线时无法保存该采样，实时接口仍报告失败 */
    private boolean databaseHealthy;

    /** 获取并验证数据库连接耗时，单位毫秒；不等同于具体业务SQL响应时间 */
    private long databaseLatencyMs;
}
