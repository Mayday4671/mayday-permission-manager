package com.mayday.relay;

import com.mayday.common.BaseEntity;
import com.mayday.netty.RelayConfig;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 管理端持久配置；不把 Spring/JPA 依赖带入可独立复制的 mayday-netty 核心。 */
@Entity
@Table(name = "udp_relay_config")
@Getter
@Setter
public class RelaySettings extends BaseEntity {
  @Column(nullable = false, length = 64)
  private String bindIp;

  @Column(nullable = false)
  private int bindPort;

  @Column(nullable = false, length = 64)
  private String targetIp;

  @Column(nullable = false)
  private int targetPort;

  @Column(name = "receive_buffer_mib", nullable = false)
  private int receiveBufferMiB;

  @Column(name = "send_buffer_mib", nullable = false)
  private int sendBufferMiB;

  @Column(name = "pending_memory_mib", nullable = false)
  private int pendingMemoryMiB;

  @Column(nullable = false, length = 64)
  private String sendIp;

  @Column(nullable = false)
  private int sendPort;

  @Column(nullable = false, length = 10)
  private String transportMode;

  public RelayConfig toConfig() {
    return new RelayConfig(
        bindIp,
        bindPort,
        targetIp,
        targetPort,
        receiveBufferMiB,
        sendBufferMiB,
        pendingMemoryMiB,
        sendIp,
        sendPort,
        transportMode);
  }

  public void apply(RelayConfig value) {
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
