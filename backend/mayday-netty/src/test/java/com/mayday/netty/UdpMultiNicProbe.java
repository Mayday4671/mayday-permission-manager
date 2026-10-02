package com.mayday.netty;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.net.StandardProtocolFamily;
import java.net.StandardSocketOptions;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.BitSet;
import java.util.HashMap;
import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.locks.LockSupport;

/**
 * 隔离三网卡验收工具：源 A、源 B、转发器、接收器分别运行在不同容器/JVM。 测试序号位于第 9–16 字节，不影响业务前八字节。目标只允许回环/私网，脚本另使用 Docker
 * internal 网络。 不属于业务 HTTP 接口，不随应用启动；结果写到专用验收目录，所有失败保留。
 */
public final class UdpMultiNicProbe {
  /** 显式启动隔离源端、转发或接收角色，按序号和源地址核对结果；校验失败退出，不在应用启动时执行。 */
  public static void main(String[] args) throws Exception {
    Map<String, String> options = new HashMap<>();
    for (int i = 0; i < args.length; i += 2) options.put(args[i], args[i + 1]);
    String role = options.get("--role");
    Path out = Path.of(options.getOrDefault("--out", "/results"));
    Files.createDirectories(out);
    int seconds = Integer.parseInt(options.getOrDefault("--seconds", "30"));
    int size = Integer.parseInt(options.getOrDefault("--size", "1472"));
    int minSize = Integer.parseInt(options.getOrDefault("--min-size", String.valueOf(size)));
    int maxSize = Integer.parseInt(options.getOrDefault("--max-size", String.valueOf(size)));
    if (seconds < 1 || seconds > 600 || size < 16 || size > 65507)
      throw new IllegalArgumentException("测试范围无效");
    switch (role) {
      case "relay" -> {
        String target = options.get("--target"), source = options.get("--source");
        privateAddress(target);
        privateAddress(source);
        // 可选诊断采样只用于验收进程；不会进入可复用核心或生产依赖。
        jdk.jfr.consumer.RecordingStream recording = null;
        var profile =
            new java.util.concurrent.ConcurrentHashMap<
                String, java.util.concurrent.atomic.AtomicInteger>();
        if (Boolean.parseBoolean(options.getOrDefault("--profile", "false"))) {
          recording = new jdk.jfr.consumer.RecordingStream();
          recording.enable("jdk.ExecutionSample").withPeriod(java.time.Duration.ofMillis(5));
          recording.enable("jdk.NativeMethodSample").withPeriod(java.time.Duration.ofMillis(5));
          recording.onEvent(
              event -> {
                var thread = event.getThread("sampledThread");
                var trace = event.getStackTrace();
                if (thread == null
                    || !thread.getJavaName().startsWith("udp-relay")
                    || trace == null) return;
                String key =
                    trace.getFrames().stream()
                        .limit(6)
                        .map(f -> f.getMethod().getType().getName() + "." + f.getMethod().getName())
                        .collect(java.util.stream.Collectors.joining(" > "));
                profile
                    .computeIfAbsent(key, k -> new java.util.concurrent.atomic.AtomicInteger())
                    .incrementAndGet();
              });
          recording.startAsync();
        }
        try (var relay = new UdpRelay()) {
          relay.start(
              new RelayConfig(
                  "0.0.0.0",
                  19000,
                  target,
                  19001,
                  16,
                  16,
                  64,
                  source,
                  19003,
                  options.getOrDefault("--transport", "AUTO")));
          Files.writeString(out.resolve("relay-ready"), "ready");
          long deadline = System.nanoTime() + (seconds + 60L) * 1_000_000_000L;
          while (!Files.exists(out.resolve("relay-stop")) && System.nanoTime() < deadline) {
            Files.writeString(
                out.resolve("samples.jsonl"),
                json(relay.snapshot()) + "\n",
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND);
            Thread.sleep(1000);
          }
          var result = relay.stop();
          Files.writeString(out.resolve("relay.json"), json(result));
          if (recording != null) {
            Thread.sleep(1500);
            recording.close();
            Files.writeString(
                out.resolve("profile.txt"),
                profile.entrySet().stream()
                    .sorted((a, b) -> Integer.compare(b.getValue().get(), a.getValue().get()))
                    .map(e -> e.getValue() + "\t" + e.getKey())
                    .collect(java.util.stream.Collectors.joining("\n")));
          }
          if (result.pendingPackets() != 0
              || result.invalidPackets() != 0
              || result.overflowPackets() != 0
              || result.sendFailures() != 0
              || result.receiveErrors() != 0
              || result.kernelDrops() == null
              || result.kernelDrops() != 0) throw new IllegalStateException("转发器丢包/错误检查失败");
        }
      }
      case "source" -> {
        String target = options.get("--target");
        privateAddress(target);
        int offset = Integer.parseInt(options.getOrDefault("--offset", "0"));
        double mbps = Double.parseDouble(options.getOrDefault("--mbps", "125"));
        if (mbps < 1 || mbps > 500) throw new IllegalArgumentException("单源速率超限");
        var plan = ProbePacketPlan.create(offset, mbps, seconds, minSize, maxSize);
        int count = plan.count();
        long startAt = Long.parseLong(options.get("--start-at"));
        try (var channel = java.nio.channels.DatagramChannel.open(StandardProtocolFamily.INET)) {
          channel.setOption(StandardSocketOptions.SO_SNDBUF, 16 * 1024 * 1024);
          channel.connect(new InetSocketAddress(target, 19000));
          ByteBuffer packet = ByteBuffer.allocateDirect(maxSize);
          for (int j = 0; j < maxSize; j++) packet.put((byte) (j * 31 + 7));
          long delay = startAt - System.currentTimeMillis();
          if (delay > 0) Thread.sleep(delay);
          long start = System.nanoTime(), sentBytes = 0;
          double interval = 8 * 1000.0 / mbps;
          for (int i = 0; i < count; i++) {
            int length = ProbePacketPlan.length(offset + (long) i, minSize, maxSize);
            long due = start + (long) (sentBytes * interval), remaining;
            while ((remaining = due - System.nanoTime()) > 0) {
              if (remaining > 200_000) LockSupport.parkNanos(remaining - 100_000);
              else Thread.onSpinWait();
            }
            packet.clear().limit(length);
            packet.putLong(8, offset + (long) i);
            if (channel.write(packet) != length) throw new IllegalStateException("源端未完整写入");
            sentBytes += length;
          }
          double rate = sentBytes * 8.0 / ((System.nanoTime() - start) / 1e9) / 1e6;
          Files.writeString(
              out.resolve("source-" + offset + ".json"),
              "{\"sent\":" + count + ",\"bytes\":" + sentBytes + ",\"mbps\":" + rate + "}");
        }
      }
      case "sink" -> {
        int count = Integer.parseInt(options.get("--count"));
        String expectedSource = options.get("--source");
        privateAddress(expectedSource);
        BitSet sequences = new BitSet(count);
        int received = 0, duplicate = 0, corrupt = 0, wrongSource = 0;
        long first = 0, last = 0, uniqueBytes = 0;
        try (var socket = new DatagramSocket(null)) {
          socket.setReceiveBufferSize(16 * 1024 * 1024);
          socket.setSoTimeout(200);
          socket.bind(new InetSocketAddress("0.0.0.0", 19001));
          if (socket.getReceiveBufferSize() < 16 * 1024 * 1024)
            throw new IllegalStateException("接收器系统缓冲不足");
          Files.writeString(out.resolve("sink-ready"), "ready");
          byte[] data = new byte[65536];
          ByteBuffer decoded = ByteBuffer.wrap(data);
          var packet = new DatagramPacket(data, data.length);
          long deadline = System.nanoTime() + (seconds + 60L) * 1_000_000_000L;
          // Windows 共享目录的一次 stat 可能阻塞数百微秒，绝不能逐包读停止文件。
          // 只在每秒控制检查或 socket 空闲时读取，数据路径仅做内存校验。
          long nextControl = System.nanoTime() + 1_000_000_000L;
          while (received < count && System.nanoTime() < deadline) {
            long clock = System.nanoTime();
            if (clock >= nextControl) {
              if (Files.exists(out.resolve("sink-stop"))) break;
              nextControl = clock + 1_000_000_000L;
            }
            packet.setLength(data.length);
            try {
              socket.receive(packet);
            } catch (SocketTimeoutException ignored) {
              continue;
            }
            long now = System.nanoTime();
            if (first == 0) first = now;
            last = now;
            received++;
            if (!packet.getAddress().getHostAddress().equals(expectedSource)
                || packet.getPort() != 19003) wrongSource++;
            long seq = packet.getLength() >= 16 ? decoded.getLong(8) : -1;
            boolean valid =
                seq >= 0
                    && seq < count
                    && packet.getLength() == ProbePacketPlan.length(seq, minSize, maxSize);
            if (valid)
              for (int j = 0; j < packet.getLength(); j++) {
                if (j >= 8 && j < 16) continue;
                if (data[j] != (byte) (j == 2 ? 3 : j == 3 ? 1 : j * 31 + 7)) {
                  valid = false;
                  break;
                }
              }
            if (!valid) corrupt++;
            else {
              if (sequences.get((int) seq)) duplicate++;
              else uniqueBytes += packet.getLength();
              sequences.set((int) seq);
            }
          }
        }
        int unique = sequences.cardinality();
        double rate = uniqueBytes * 8.0 / Math.max(0.001, (last - first) / 1e9) / 1e6;
        double targetMbps = Double.parseDouble(options.getOrDefault("--mbps", "250"));
        Files.writeString(
            out.resolve("sink.json"),
            "{\"received\":"
                + received
                + ",\"unique\":"
                + unique
                + ",\"missing\":"
                + (count - unique)
                + ",\"duplicate\":"
                + duplicate
                + ",\"corrupt\":"
                + corrupt
                + ",\"wrongSource\":"
                + wrongSource
                + ",\"bytes\":"
                + uniqueBytes
                + ",\"mbps\":"
                + rate
                + "}");
        if (unique != count
            || duplicate != 0
            || corrupt != 0
            || wrongSource != 0
            || rate < targetMbps * 0.995) throw new IllegalStateException("多网卡端点核对失败");
      }
      default -> throw new IllegalArgumentException("role 无效");
    }
  }

  /** 限定数值 IPv4 与私网/回环地址，验收工具不通过 DNS 解析或向第三方地址发送流量。 */
  static void privateAddress(String ip) {
    if (ip == null || !io.netty.util.NetUtil.isValidIpV4Address(ip))
      throw new IllegalArgumentException("只允许数值 IPv4");
    InetAddress value = RelayConfig.address(ip);
    if (!value.isSiteLocalAddress() && !value.isLoopbackAddress())
      throw new IllegalArgumentException("验收工具只允许回环/私网");
  }

  /** 只序列化本工具固定 record 的标量字段，避免为验收工具引入 JSON/业务框架依赖。 */
  static String json(Record value) throws Exception {
    StringJoiner result = new StringJoiner(",", "{", "}");
    for (var field : value.getClass().getRecordComponents()) {
      Object item = field.getAccessor().invoke(value);
      result.add(
          "\""
              + field.getName()
              + "\":"
              + (item == null
                  ? "null"
                  : item instanceof String
                      ? "\""
                          + item.toString()
                              .replace("\\", "\\\\")
                              .replace("\"", "\\\"")
                              .replace("\n", "\\n")
                              .replace("\r", "\\r")
                          + "\""
                      : item.toString()));
    }
    return result.toString();
  }
}
