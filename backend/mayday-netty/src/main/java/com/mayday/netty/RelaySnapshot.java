package com.mayday.netty;

import java.time.Instant;

/**
 * 每秒发布不可变快照，网络热路径不读数据库、不记录逐包日志、不争用原子计数器。 forwardedPackets 只表示发送成功交给本机内核；UDP 无 ACK，不能据此断言对端收到。
 * received = forwarded + pending + invalid + overflow + sendFailures；kernelDrops 在 received 之前发生。
 * 速率按 UDP 有效负载字节、十进制 Mbps 计算，不含 UDP/IP/以太网开销。null 系统丢包表示无法观测。
 */
public record RelaySnapshot(
    String runId,
    String state,
    String transport,
    String startedAt,
    String sampledAt,
    long receivedPackets,
    long forwardedPackets,
    long receivedBytes,
    long forwardedBytes,
    long pendingPackets,
    long pendingBytes,
    long invalidPackets,
    long overflowPackets,
    long sendFailures,
    long receiveErrors,
    Long kernelDrops,
    double receiveMbps,
    double forwardMbps,
    double receivePps,
    double forwardPps,
    double peakForwardMbps,
    int actualReceiveBuffer,
    int actualSendBuffer,
    String lastError,
    String boundAddress,
    String sendAddress,
    String lastSender) {
  /** 构造从未启动的空快照；内核丢包不可观测时保留 null，避免被误解为零丢包。 */
  public static RelaySnapshot idle() {
    return new RelaySnapshot(
        "",
        "STOPPED",
        "",
        null,
        Instant.now().toString(),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        null,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        "",
        "",
        "",
        "");
  }
}
