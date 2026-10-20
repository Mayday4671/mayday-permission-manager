package com.mayday.relay;

import com.mayday.common.persistence.BaseEntity;
import com.mayday.netty.RelayConfig;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 管理端持久配置；不把 Spring 依赖带入可独立复制的 mayday-netty 核心。 */
@Getter
@Setter
@Table(value = "udp_relay_config", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class RelaySettings extends BaseEntity
{
    private String bindIp;
    private int bindPort;
    private String targetIp;
    private int targetPort;

    /** 缓冲列名与驼峰自动转换结果不同，必须显式指定。 */
    @Column("receive_buffer_mib")
    private int receiveBufferMiB;

    @Column("send_buffer_mib")
    private int sendBufferMiB;

    @Column("pending_memory_mib")
    private int pendingMemoryMiB;

    private String sendIp;
    private int sendPort;
    private String transportMode;

    /** 将持久化配置投影为无 Spring/JPA 依赖的核心参数，由核心构造器统一验证网卡与范围。 */
    public RelayConfig toConfig()
    {
        return new RelayConfig(bindIp, bindPort, targetIp, targetPort, receiveBufferMiB, sendBufferMiB,
                pendingMemoryMiB, sendIp, sendPort, transportMode);
    }

    /** 只复制已校验配置的白名单字段，运行状态、统计数字和数据库版本不从请求覆盖。 */
    public void apply(RelayConfig value)
    {
        bindIp = value.bindIp();
        bindPort = value.bindPort();
        targetIp = value.targetIp();
        targetPort = value.targetPort();
        receiveBufferMiB = value.receiveBufferMiB();
        sendBufferMiB = value.sendBufferMiB();
        pendingMemoryMiB = value.pendingMemoryMiB();
        sendIp = value.sendIp();
        sendPort = value.sendPort();
        transportMode = value.transportMode();
    }
}
