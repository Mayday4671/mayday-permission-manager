package com.mayday.netty;

import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.PooledByteBufAllocator;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoop;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.FixedRecvByteBufAllocator;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.epoll.Epoll;
import io.netty.channel.epoll.EpollChannelOption;
import io.netty.channel.epoll.EpollDatagramChannel;
import io.netty.channel.epoll.EpollEventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.DatagramPacket;
import io.netty.channel.socket.InternetProtocolFamily;
import io.netty.channel.socket.nio.NioDatagramChannel;
import io.netty.util.concurrent.DefaultThreadFactory;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 独立 UDP 转发器；普通 Java 程序也可 new UdpRelay() / start(config) / snapshot() / stop()。 一条收发链路共用一个
 * EventLoop，原缓冲就地修改、引用计数转交发送，按接收批次 flush。 不引入跨线程业务队列、不做数据库逐包写入。发送端拥塞时内存有界，并明确计数拒绝的数据包。
 * 原始协议无序号/重传确认，组件不会伪造“网络绝不丢包”；端到端验收需由收发端核对序号。
 */
public final class UdpRelay implements AutoCloseable {
  private volatile Session session;

  /** 读取最近发布的不可变统计，不进入网络线程；尚未启动时返回停止状态的空快照。 */
  public RelaySnapshot snapshot() {
    Session value = session;
    return value == null ? RelaySnapshot.idle() : value.snapshot;
  }

  /** 串行启动单路转发，拒绝覆盖运行中的会话；监听开放前必须完成缓冲和发送通道校验。 */
  public synchronized RelaySnapshot start(RelayConfig config) {
    if (session != null && session.state.equals("RUNNING"))
      throw new IllegalStateException("转发正在运行，请先停止");
    if (session != null) session.stop();
    Session next = new Session(config);
    session = next;
    next.start();
    return next.snapshot;
  }

  /** 停止接收并等待已提交发送结果归账；保留最终快照供页面核对本次运行计数。 */
  public synchronized RelaySnapshot stop() {
    if (session != null) session.stop();
    return snapshot();
  }

  @Override
  public void close() {
    stop();
  }

  /**
   * 转发前统一处理 UDP 负载中的业务字段；后续其他字段的修改集中在此方法扩展。 当前规则：按负载第一个字节为第 1 字节，第 3、4 字节分别替换为 0x03、0x01。 这里处理的是
   * UDP 负载，不包含 IP 头或 UDP 头；其余字节和负载长度保持不变。
   *
   * <p>调用方已校验 readableBytes() 至少为 8；扩展到更后面的字段时，需要同步调整 channelRead0 中的最小长度校验，不能把缓冲容量当作实际收到的报文长度。
   * 偏移始终相对于 readerIndex()，兼容读索引非零或切片缓冲；使用 setByte 原地 修改，不移动读写索引、不复制数据，也不在此方法中 retain/release 缓冲。
   * 本方法运行在收发 EventLoop 上，扩展逻辑应避免阻塞操作和逐包日志。
   *
   * @param data 已通过长度校验、即将转发的可写 UDP 负载缓冲
   */
  private static void processPacketFields(ByteBuf data) {
    int base = data.readerIndex();
    data.setByte(base + 2, 0x03);
    data.setByte(base + 3, 0x01);
  }

  /** 一次运行独占单个 EventLoop 和收发通道；可变计数只在该线程写入，外部只读快照。 */
  private static final class Session {
    final RelayConfig config;
    final String runId = UUID.randomUUID().toString(), startedAt = Instant.now().toString();
    final boolean epoll;
    final EventLoopGroup group;
    final EventLoop loop;
    final CompletableFuture<Void> drained = new CompletableFuture<>();
    volatile RelaySnapshot snapshot = RelaySnapshot.idle();
    volatile String state = "STARTING";
    DatagramChannel inbound, outbound;
    LinuxUdpDrops drops;
    ScheduledFuture<?> ticker;
    boolean stopping;
    // 以下字段只在 loop 中更新；REST 线程只读 volatile 不可变快照。
    long received,
        forwarded,
        receivedBytes,
        forwardedBytes,
        pending,
        pendingBytes,
        pendingMemory,
        invalid,
        overflow,
        sendFailures,
        receiveErrors;
    long lastNanos = System.nanoTime(), lastRx, lastTx, lastRxBytes, lastTxBytes;
    Long kernelDrops;
    double peak;
    int receiveBuffer, sendBuffer;
    String lastError = "";
    InetSocketAddress lastSender;

    Session(RelayConfig config) {
      this.config = config;
      if (config.transportMode().equals("EPOLL") && !Epoll.isAvailable())
        throw new IllegalArgumentException("当前平台 EPOLL 不可用，请选择 NIO 或 AUTO");
      epoll = !config.transportMode().equals("NIO") && Epoll.isAvailable();
      var factory = new DefaultThreadFactory("udp-relay", true);
      group = epoll ? new EpollEventLoopGroup(1, factory) : new NioEventLoopGroup(1, factory);
      loop = group.next();
    }

    Bootstrap bootstrap(boolean receiver) {
      // 显式选择地址族，避免 IPv4 监听实际落入 IPv6 双栈 socket，导致 /proc 丢包归属查询失配。
      var family =
          config.bindAddress().getAddress().getAddress().length == 4
              ? InternetProtocolFamily.IPv4
              : InternetProtocolFamily.IPv6;
      var b =
          new Bootstrap()
              .group(loop)
              .channelFactory(
                  () -> epoll ? new EpollDatagramChannel(family) : new NioDatagramChannel(family));
      b.option(ChannelOption.ALLOCATOR, PooledByteBufAllocator.DEFAULT)
          .option(ChannelOption.SO_REUSEADDR, false)
          .option(ChannelOption.SO_BROADCAST, false)
          .option(ChannelOption.SO_RCVBUF, config.receiveBufferMiB() * 1024 * 1024)
          .option(ChannelOption.SO_SNDBUF, config.sendBufferMiB() * 1024 * 1024)
          // 先绑定、校验实际缓冲，最后才启用接收，禁止缓冲被系统裁小后仍带病开流。
          .option(ChannelOption.AUTO_READ, false);
      if (epoll) b.option(EpollChannelOption.SO_REUSEPORT, false);
      if (receiver) {
        // 65536 可容纳完整 UDP 数据报，不能用常见的 2048 接收缓冲静默截断大包。
        var allocator = new FixedRecvByteBufAllocator(65536);
        allocator.maxMessagesPerRead(64);
        b.option(ChannelOption.RCVBUF_ALLOCATOR, allocator);
      }
      return b;
    }

    void start() {
      try {
        outbound =
            (DatagramChannel)
                bootstrap(false)
                    .handler(new ChannelInboundHandlerAdapter())
                    .connect(config.targetAddress(), config.sendAddress())
                    .syncUninterruptibly()
                    .channel();
        // 在接收端口开放前准备一批直接内存，避免首批大流量承担池化内存首次分配的停顿。
        // 只分配本地缓冲，不发送预热包，不影响业务包和统计；仍需部署环境提供足够的 socket 缓冲。
        loop.submit(
                () -> {
                  ByteBuf[] buffers = new ByteBuf[64];
                  try {
                    for (int i = 0; i < buffers.length; i++)
                      buffers[i] = PooledByteBufAllocator.DEFAULT.directBuffer(65536, 65536);
                  } finally {
                    for (ByteBuf buffer : buffers) if (buffer != null) buffer.release();
                  }
                })
            .syncUninterruptibly();
        inbound =
            (DatagramChannel)
                bootstrap(true)
                    .handler(
                        new SimpleChannelInboundHandler<DatagramPacket>() {
                          @Override
                          protected void channelRead0(
                              ChannelHandlerContext ctx, DatagramPacket packet) {
                            var data = packet.content();
                            int length = data.readableBytes();
                            received++;
                            receivedBytes += length;
                            // 保存已有地址对象，字符串只在每秒快照里生成，避免逐包地址格式化拖慢热路径。
                            lastSender = packet.sender();
                            if (length < 8) {
                              invalid++;
                              return;
                            }
                            // EPOLL 的短切片仍持有整块 64 KiB 接收缓冲，按至少一整块缓冲计费。
                            // 不能把 100 字节切片误当作仅占用 100 字节直接内存。
                            long memory = Math.max(65536L, data.capacity()) + 256;
                            if (pendingMemory + memory
                                > (long) config.pendingMemoryMiB() * 1024 * 1024) {
                              overflow++;
                              return;
                            }
                            processPacketFields(data);
                            pending++;
                            pendingBytes += length;
                            pendingMemory += memory;
                            outbound
                                .write(data.retain())
                                .addListener(
                                    future -> {
                                      pending--;
                                      pendingBytes -= length;
                                      pendingMemory -= memory;
                                      if (future.isSuccess()) {
                                        forwarded++;
                                        forwardedBytes += length;
                                      } else {
                                        sendFailures++;
                                        lastError = message(future.cause());
                                      }
                                      if (stopping && pending == 0) drained.complete(null);
                                    });
                          }

                          @Override
                          public void channelReadComplete(ChannelHandlerContext ctx) {
                            outbound.flush();
                          }

                          @Override
                          public void exceptionCaught(ChannelHandlerContext ctx, Throwable error) {
                            receiveErrors++;
                            lastError = message(error);
                          }
                        })
                    .bind(config.bindAddress())
                    .syncUninterruptibly()
                    .channel();
        receiveBuffer = inbound.config().getReceiveBufferSize();
        sendBuffer = outbound.config().getSendBufferSize();
        // Linux 原生 getsockopt 返回包含加倍管理开销的值，JDK NIO 已做除二；统一为申请值口径。
        if (epoll) {
          receiveBuffer /= 2;
          sendBuffer /= 2;
        }
        if (receiveBuffer < (long) config.receiveBufferMiB() * 1024 * 1024
            || sendBuffer < (long) config.sendBufferMiB() * 1024 * 1024)
          throw new IllegalStateException(
              "系统收发缓冲不足：实际接收 "
                  + receiveBuffer
                  + "、发送 "
                  + sendBuffer
                  + " 字节；请先提高操作系统 rmem_max/wmem_max，再启动转发");
        drops = new LinuxUdpDrops(inbound.localAddress());
        state = "RUNNING";
        loop.submit(
                () -> {
                  publish(true);
                  inbound.config().setAutoRead(true);
                })
            .syncUninterruptibly();
        ticker = loop.scheduleAtFixedRate(() -> publish(true), 1, 1, TimeUnit.SECONDS);
      } catch (Exception error) {
        lastError = message(error);
        state = "FAILED";
        stop();
        throw new IllegalStateException("UDP 监听启动失败：" + lastError, error);
      }
    }

    void publish(boolean running) {
      if (drops != null) {
        Long value = drops.read();
        if (value != null) kernelDrops = value;
      }
      long now = System.nanoTime();
      double seconds = Math.max(0.001, (now - lastNanos) / 1e9);
      double rx = running ? (receivedBytes - lastRxBytes) * 8 / seconds / 1e6 : 0,
          tx = running ? (forwardedBytes - lastTxBytes) * 8 / seconds / 1e6 : 0;
      double rxPps = running ? (received - lastRx) / seconds : 0,
          txPps = running ? (forwarded - lastTx) / seconds : 0;
      peak = Math.max(peak, tx);
      lastNanos = now;
      lastRx = received;
      lastTx = forwarded;
      lastRxBytes = receivedBytes;
      lastTxBytes = forwardedBytes;
      snapshot =
          new RelaySnapshot(
              runId,
              state,
              epoll ? "EPOLL" : "NIO",
              startedAt,
              Instant.now().toString(),
              received,
              forwarded,
              receivedBytes,
              forwardedBytes,
              pending,
              pendingBytes,
              invalid,
              overflow,
              sendFailures,
              receiveErrors,
              kernelDrops,
              rx,
              tx,
              rxPps,
              txPps,
              peak,
              receiveBuffer,
              sendBuffer,
              lastError,
              inbound == null ? "" : format(inbound.localAddress()),
              outbound == null ? "" : format(outbound.localAddress()),
              format(lastSender));
    }

    void stop() {
      if (group.isShuttingDown()) return;
      // 先停止接收，再等待已进入应用的写请求完成；停流时应先停止上游发包。
      loop.submit(
              () -> {
                stopping = true;
                if (drops != null) kernelDrops = drops.read();
                if (inbound != null) inbound.close();
                if (outbound != null) outbound.flush();
                if (pending == 0) drained.complete(null);
              })
          .syncUninterruptibly();
      try {
        drained.get(3, TimeUnit.SECONDS);
      } catch (Exception e) {
        lastError = "停止等待超时，剩余发送将在关闭时计为失败";
      }
      if (inbound != null) inbound.close().syncUninterruptibly();
      if (outbound != null) outbound.close().syncUninterruptibly();
      loop.submit(
              () -> {
                if (ticker != null) ticker.cancel(false);
                if (!state.equals("FAILED")) state = "STOPPED";
                publish(false);
              })
          .syncUninterruptibly();
      group.shutdownGracefully(0, 3, TimeUnit.SECONDS).syncUninterruptibly();
    }

    static String message(Throwable error) {
      if (error == null) return "发送失败";
      String text = error.getMessage();
      return (text == null ? error.getClass().getSimpleName() : text)
          .substring(
              0, Math.min(300, (text == null ? error.getClass().getSimpleName() : text).length()));
    }

    static String format(InetSocketAddress address) {
      if (address == null) return "";
      String ip = address.getAddress().getHostAddress();
      return (ip.contains(":") ? "[" + ip + "]" : ip) + ":" + address.getPort();
    }
  }
}
