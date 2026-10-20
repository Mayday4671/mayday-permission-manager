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

    /** 接收绑定 IP；必须为转发服务器本地网卡地址或同地址族通配地址，不是浏览器所在电脑 IP */
    private String bindIp;

    /** UDP 接收端口；允许 1024 至 65535，容器部署须另外映射此 UDP 端口 */
    private int bindPort;

    /** 唯一转发目标的单播 IP；不使用域名、组播、广播或通配地址，禁止指向本机相同接收端口 */
    private String targetIp;

    /** 唯一转发目标 UDP 端口；允许 1 至 65535，对端必须另行监听并核对接收情况 */
    private int targetPort;

    /** 缓冲列名与驼峰自动转换结果不同，必须显式指定。 */
    @Column("receive_buffer_mib")
    private int receiveBufferMiB;

    /** 申请内核发送缓冲大小，单位 MiB，范围 1 至 64；页面展示实际授予值 */
    @Column("send_buffer_mib")
    private int sendBufferMiB;

    /** 应用待发送缓冲内存上限，单位 MiB，范围 1 至 256；按缓冲容量及额外开销计量，超限计数丢弃 */
    @Column("pending_memory_mib")
    private int pendingMemoryMiB;

    /** 应用待发送缓冲内存上限，单位 MiB，范围 1 至 256；按缓冲容量及额外开销计量，超限计数丢弃 */
    private String sendIp;

    /** 发送本地 UDP 源端口；0 为系统分配，或指定 1024 至 65535；独立于接收端口，不自动处理回包 */
    private int sendPort;

    /**
     * Netty UDP 传输模式：AUTO 优先 Linux EPOLL 否则 NIO；可固定 NIO 或 EPOLL
     * 用于平台兼容验证，不可用的强制模式拒绝启动
     */
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
