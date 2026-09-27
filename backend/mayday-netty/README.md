# 独立 Netty UDP 转发模块

本目录可整体复制到其他 Java 项目。独立 POM 不依赖 Mayday 父工程、Spring、数据库或权限系统；JDK 17+ 可构建。使用 [Netty 4.1.105.Final](https://netty.io/news/2024/01/16/4-1-105-Final.html)，只引入传输相关依赖。Linux 优先 EPOLL，原生库不可用时自动使用 NIO；Windows 使用 NIO。

## 接入

在本目录执行 `mvn clean verify`，普通 JAR 输出到 `target/mayday-netty-1.0.0.jar`。执行 `mvn install` 后，宿主项目添加 `com.mayday:mayday-netty:1.0.0` 依赖。宿主若有 Netty BOM，也应统一为 4.1.105.Final，避免只锁主包而混入其他版本的传递依赖。迁移时不需要复制 Mayday 的数据库或登录模块。

```java
// 生命周期交给宿主应用管理。服务退出时 close；关闭浏览器不等于停止转发。
UdpRelay relay = new UdpRelay();
relay.start(new RelayConfig(
    "0.0.0.0", 19000,       // 本服务器监听 IP、UDP 端口
    "192.168.1.20", 19001,  // 单个目标 IP、UDP 端口
    16, 16, 64,
    "192.168.1.10", 0,      // 独立发送源 IP（必须为本机地址）；源端口 0 由系统分配
    "AUTO"));               // AUTO / NIO / EPOLL；强制 EPOLL 在不支持的平台明确报错
RelaySnapshot snapshot = relay.snapshot(); // 每秒更新的不可变快照
relay.stop();               // 先停止上游发包，再等待已进入应用的发送排空
relay.close();
```

导入类型为 `com.mayday.netty.UdpRelay`、`RelayConfig` 和 `RelaySnapshot`。`start`、`stop` 已串行化；运行中重复启动被拒绝，停止可重复调用。每次启动创建新的 `runId` 并从零计数；停止保留最后计数，进程重启不保留运行状态。启动失败释放 socket 和线程，端口冲突解决后可重试。

七参数 `RelayConfig` 构造继续兼容，等价于 `sendIp=""`、`sendPort=0`、`transportMode="AUTO"`。`LocalInterfaces.list()` 列出运行进程可见的本地网卡地址；容器内看到的是容器网卡。

多网卡时接收通道只 bind、不 connect，接受发往配置地址/端口的不同上游；发送通道单独绑定源 IP/端口后连接唯一目标。接收端不使用地址/端口复用，不引入流量整形器。`sendIp` 控制源地址，**不是 SO_BINDTODEVICE**；同网段多网卡、多个默认网关或策略路由必须由操作系统正确配置，不能靠 Java 源地址绑定代替。绑定 `0.0.0.0` 并不能接收目的 IP 不属于本机的普通单播包。

## 数据包约定

- 按字节从 1 开始计数：**第 3 字节改为 `03`，第 4 字节改为 `01`**，不是字符串替换，也不依赖 CPU 大小端。
- UDP 有效负载至少 8 字节。不足 8 字节计入 `invalidPackets` 并丢弃，不填充、不伪造数据。
- 其他字节、负载长度和数据报边界不变。接收缓冲为 65536 字节，可容纳完整 UDP 数据报；测试覆盖 8、1472、65507 字节。
- 单路接收、单个单播目标；不处理组播入组、广播、协议重传、持久队列或多目标复制。收发 socket 不同，转发后的源 IP/端口由本机路由和发送 socket 决定，不保留原源端口。

## 性能与计数

业务字段处理集中在 [`UdpRelay.processPacketFields(ByteBuf data)`](src/main/java/com/mayday/netty/UdpRelay.java)。接收处理器 `channelRead0` 在完成长度和待发送内存校验后、提交转发前调用它。后续新增字段修改可直接扩展此方法；字节偏移以 `readerIndex()` 为起点，使用 `setByte` 等绝对写入方法保持读写索引、负载长度不变。若新增字段超出前 8 字节，应同步提高调用处的最小报文长度校验。此方法不负责缓冲释放，也不应加入阻塞操作或逐包日志。

收发共用一个 EventLoop，直接缓冲原地修改，引用计数转给发送，接收批次结束时 flush；无逐包日志、数据库写入、阻塞业务队列。开放接收端口前预分配一批池化直接缓冲，减少首批流量的内存初始化停顿，不发送预热包。待发送内存按至少 64 KiB 接收缓冲加开销计算，EPOLL 的短切片也按其持有的完整缓冲计费；超限明确计入 `overflowPackets`，避免无限缓存耗尽内存。

**从 V17 起，实际收发缓冲低于配置申请值时拒绝启动，不启用读事件。** Linux 运维应先检查/调整 `net.core.rmem_max` 与 `wmem_max`；只放大应用队列无法补回内核已经丢掉的包。快照的实际缓冲统一为申请值口径：EPOLL 原生返回值除去 Linux 加倍的管理开销，NIO 使用 JDK 返回值，避免两种模式显示一倍差异。缓冲充足只是启动条件，不是任意外部链路绝不丢包的证明。

每个快照满足：

`receivedPackets = forwardedPackets + pendingPackets + invalidPackets + overflowPackets + sendFailures`

`forwardedPackets` 表示本机 UDP 写请求成功，不能作为对端确认。`kernelDrops` 只读当前监听 socket 的 Linux `/proc/net/udp[6]` 丢包值，发生在应用收包前；Windows、不支持的内核或不可读时为 `null`，不能当作零。网卡、链路、对端或内核更早阶段的丢包仍需要端点序号核对。`receiveErrors` 是异常次数，不擅自换算成丢包数。

速率采用 UDP 有效负载、十进制 Mbps（200 Mbps = 25 MB/s），不含链路头。持续速率取决于包长、PPS、CPU、socket 缓冲、网卡和部署网络；不能把一次回环测试解释为任意网络绝对不丢包。

## 可重复验收

执行 `mvn test dependency:copy-dependencies -DincludeScope=runtime` 后，在本目录运行：

```sh
# Linux / macOS；Windows 的 classpath 分隔符使用分号。
java -cp 'target/test-classes:target/classes:target/dependency/*' \
  com.mayday.netty.UdpRelayBenchmark --seconds 30 --mbps 250 --size 1472 --transport AUTO
```

工具仅使用 `127.0.0.1`，默认监听 19000/19001，不向外部主机发流。每包第 9–16 字节写测试序号，对端验证所有其余字节（包括 `03 01`），输出发送/唯一接收/缺失/重复/错误/乱序和实际速率。未达到目标速率（见下方计时容差）或有缺失、重复、内容错误时返回失败退出码。

用户确认的业务负载为 100–1472 字节随机包长、200 Mbps。对应命令在上述 classpath 后使用 `com.mayday.netty.UdpRelayBenchmark --seconds 300 --mbps 200 --min-size 100 --max-size 1472`。序号经固定哈希映射到包长区间，覆盖区间内各长度，可复现并由两端独立校验；按实际累计字节安排发包时间，不把固定 PPS 错当作变长包速率。默认近似均匀的包长分布不等于任意小包集中分布。

端点总速率允许 0.5% 的调度/计时误差，缺包、重复、内容错误容差均为零。`sentBytes` 是实际负载字节数，变长模式下 `packetBytes=0`，具体范围见 `minPacketBytes/maxPacketBytes`。不要再用“包数 × 单一包长”计算变长包流量。

`--external true` 模式不启动本模块，只运行源端与接收端，适合验证正式后台启动的转发器；接收端端口必须等于配置的目标端口。相关 Mayday 页面/API/部署方式见主工程 `docs/udp-relay.md`。

主工程 `scripts/verify-udp-matrix.mjs` 执行全新 JVM 的 Windows/NIO、Linux/NIO、Linux/EPOLL 变长包 200/220 Mbps 各三轮测试；`scripts/verify-udp-multinic.mjs` 在三个独立 Docker internal 网络中验证两个上游同时进入、第三网卡向下游发送，包括五轮 30 秒测试及一轮 5 分钟持续测试，校验真实源 IP/端口、序号、字节与速率。它们不会绕过失败轮次，也不会把应用转发计数当作接收器的确认。详细结果以最近验收记录为准。
