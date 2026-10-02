package com.mayday.netty;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

/** 低流量回环校验转发统计、字节转换、绑定失败和配置边界，不代替实际网络的高吞吐验收。 */
class UdpRelayTest {
  /** 从回环临时绑定取得空闲端口；只供单进程测试使用，不代表跨进程预占端口。 */
  static int freePort() throws Exception {
    try (var socket = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      return socket.getLocalPort();
    }
  }

  /** 构造有界回环配置，所有数据报留在本机并采用生产协议处理逻辑。 */
  static RelayConfig config(int bind, int target) {
    return new RelayConfig("127.0.0.1", bind, "127.0.0.1", target, 4, 4, 16);
  }

  /**
   * 普通构建不能要求宿主机预先调整内核参数。只有完整授予 4 MiB 收发缓冲时才运行 数据报集成测试；不具备条件时 JUnit 明确记录 skipped，而不是放宽生产启动校验。
   * 缓冲不足时拒绝启动及资源回收另有下面的测试，在默认 Docker 环境也会执行。
   */
  static boolean fullSocketBuffersAvailable() throws Exception {
    try (var socket = new DatagramSocket()) {
      socket.setReceiveBufferSize(4 * 1024 * 1024);
      socket.setSendBufferSize(4 * 1024 * 1024);
      return socket.getReceiveBufferSize() >= 4 * 1024 * 1024
          && socket.getSendBufferSize() >= 4 * 1024 * 1024;
    }
  }

  /** 缓冲条件不足时明确跳过相关网络用例，避免降低生产启动校验来制造通过结果。 */
  static void requireSocketBuffers() throws Exception {
    assumeTrue(
        fullSocketBuffersAvailable(),
        "UDP 数据报集成测试需要实际 4 MiB 收发缓冲；Linux 请配置 rmem_max/wmem_max 后重跑 mvn test");
  }

  @Test
  void exactVersionAndConfigBoundaries() throws Exception {
    io.netty.util.Version.identify()
        .values()
        .forEach(v -> assertEquals("4.1.105.Final", v.artifactVersion()));
    assertThrows(IllegalArgumentException.class, () -> config(19000, 19000));
    assertThrows(
        IllegalArgumentException.class,
        () -> new RelayConfig("127.0.0.1", 19000, "0.0.0.0", 19001, 4, 4, 16));
    assertThrows(
        IllegalArgumentException.class,
        () -> new RelayConfig("https://host/", 19000, "127.0.0.1", 19001, 4, 4, 16));
    assertThrows(
        IllegalArgumentException.class,
        () -> new RelayConfig("127.0.0.1", 19000, "224.0.0.1", 19001, 4, 4, 16));
    assertThrows(
        IllegalArgumentException.class,
        () -> new RelayConfig("127.0.0.1", 19000, "127.0.0.1", 19001, 4, 4, 1000));
  }

  @Test
  void startupHonorsActualSocketBufferLimitsAndReleasesPorts() throws Exception {
    boolean enough = fullSocketBuffersAvailable();
    for (String mode :
        io.netty.channel.epoll.Epoll.isAvailable()
            ? new String[] {"NIO", "EPOLL"}
            : new String[] {"NIO"}) {
      int port = freePort(), target = freePort();
      var cfg = new RelayConfig("127.0.0.1", port, "127.0.0.1", target, 4, 4, 16, "", 0, mode);
      try (var relay = new UdpRelay()) {
        if (enough) {
          var result = relay.start(cfg);
          assertEquals("RUNNING", result.state());
          assertTrue(result.actualReceiveBuffer() >= 4 * 1024 * 1024);
          assertTrue(result.actualSendBuffer() >= 4 * 1024 * 1024);
          relay.stop();
        } else {
          var error = assertThrows(IllegalStateException.class, () -> relay.start(cfg));
          assertTrue(error.getMessage().contains("系统收发缓冲不足"));
          assertEquals("FAILED", relay.snapshot().state());
          assertEquals(0, relay.snapshot().receivedPackets());
        }
        // 无论正常停止还是启动失败，都不能遗留监听端口，下一次启动仍可占用。
        try (var socket = new DatagramSocket(port, InetAddress.getLoopbackAddress())) {
          assertEquals(port, socket.getLocalPort());
        }
      }
    }
  }

  @Test
  void patchesOnlyThirdAndFourthBytesAndNeverTruncatesLargeDatagrams() throws Exception {
    requireSocketBuffers();
    try (var sink = new DatagramSocket(0, InetAddress.getLoopbackAddress());
        var sender = new DatagramSocket();
        var relay = new UdpRelay()) {
      sink.setSoTimeout(5000);
      sink.setReceiveBufferSize(4 * 1024 * 1024);
      int port = freePort();
      var cfg = config(port, sink.getLocalPort());
      relay.start(cfg);
      assertThrows(IllegalStateException.class, () -> relay.start(cfg));
      sender.send(new DatagramPacket(new byte[7], 7, InetAddress.getLoopbackAddress(), port));
      long bytes = 7;
      for (int size : new int[] {8, 1472, 65507}) {
        byte[] payload = new byte[size];
        new Random(size).nextBytes(payload);
        bytes += size;
        sender.send(new DatagramPacket(payload, size, InetAddress.getLoopbackAddress(), port));
        var packet = new DatagramPacket(new byte[65536], 65536);
        sink.receive(packet);
        payload[2] = 3;
        payload[3] = 1;
        assertEquals(size, packet.getLength());
        assertArrayEquals(payload, Arrays.copyOf(packet.getData(), packet.getLength()));
      }
      var result = relay.stop();
      assertEquals("STOPPED", result.state());
      assertEquals(4, result.receivedPackets());
      assertEquals(3, result.forwardedPackets());
      assertEquals(bytes, result.receivedBytes());
      assertEquals(bytes - 7, result.forwardedBytes());
      assertEquals(1, result.invalidPackets());
      assertEquals(0, result.pendingPackets());
      assertEquals(0, result.sendFailures());
      assertEquals(
          result.receivedPackets(),
          result.forwardedPackets()
              + result.invalidPackets()
              + result.overflowPackets()
              + result.sendFailures());
      String run = result.runId();
      relay.start(cfg);
      assertNotEquals(run, relay.snapshot().runId());
      assertEquals(0, relay.snapshot().receivedPackets());
    }
  }

  @Test
  void occupiedPortFailsAndResourcesCanBeStartedAgain() throws Exception {
    requireSocketBuffers();
    int port;
    try (var relay = new UdpRelay()) {
      try (var occupied = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
        port = occupied.getLocalPort();
        assertThrows(IllegalStateException.class, () -> relay.start(config(port, freePort())));
        assertEquals("FAILED", relay.snapshot().state());
      }
      relay.start(config(port, freePort()));
      assertEquals("RUNNING", relay.snapshot().state());
      relay.stop();
      relay.stop();
      assertEquals("STOPPED", relay.snapshot().state());
    }
  }

  @Test
  void separateSourceBindingAndReceiveFromMultiplePeersOnBothTransports() throws Exception {
    requireSocketBuffers();
    assertTrue(LocalInterfaces.list().stream().anyMatch(n -> n.ip().equals("127.0.0.1") && n.up()));
    for (String mode :
        io.netty.channel.epoll.Epoll.isAvailable()
            ? new String[] {"NIO", "EPOLL"}
            : new String[] {"NIO"}) {
      try (var sink = new DatagramSocket(0, InetAddress.getLoopbackAddress());
          var senderA = new DatagramSocket();
          var senderB = new DatagramSocket();
          var relay = new UdpRelay()) {
        sink.setSoTimeout(5000);
        int port = freePort(), sourcePort = freePort();
        var config =
            new RelayConfig(
                "0.0.0.0",
                port,
                "127.0.0.1",
                sink.getLocalPort(),
                4,
                4,
                16,
                "127.0.0.1",
                sourcePort,
                mode);
        relay.start(config);
        // 接收端没有 connect 到转发目标，不会过滤掉两个不同上游来源端口。
        for (var sender : List.of(senderA, senderB)) {
          byte[] bytes = new byte[523];
          new Random(sender.getLocalPort()).nextBytes(bytes);
          sender.send(
              new DatagramPacket(bytes, bytes.length, InetAddress.getLoopbackAddress(), port));
          var packet = new DatagramPacket(new byte[1024], 1024);
          sink.receive(packet);
          bytes[2] = 3;
          bytes[3] = 1;
          assertArrayEquals(bytes, Arrays.copyOf(packet.getData(), packet.getLength()));
          assertEquals(sourcePort, packet.getPort());
          assertEquals("127.0.0.1", packet.getAddress().getHostAddress());
        }
        var result = relay.stop();
        assertEquals(mode, result.transport());
        assertEquals(2, result.forwardedPackets());
        assertEquals("127.0.0.1:" + sourcePort, result.sendAddress());
        assertFalse(result.lastSender().isEmpty());
      }
    }
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new RelayConfig(
                "0.0.0.0", 19000, "127.0.0.1", 19001, 4, 4, 16, "203.0.113.1", 0, "AUTO"));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new RelayConfig(
                "0.0.0.0", 19000, "127.0.0.1", 19001, 4, 4, 16, "127.0.0.1", 19000, "AUTO"));
  }
}
