-- 接收地址和发送源地址独立，适配多网卡；空源地址/零端口保留原来由系统选择的行为。
ALTER TABLE udp_relay_config
  ADD COLUMN send_ip varchar(64) NOT NULL DEFAULT '' COMMENT '发送本地源 IP；空字符串由系统路由选择，非空必须属于本机启用的网卡；不替代系统路由和 SO_BINDTODEVICE',
  ADD COLUMN send_port int NOT NULL DEFAULT 0 COMMENT '发送本地 UDP 源端口；0 为系统分配，或指定 1024 至 65535；独立于接收端口，不自动处理回包',
  ADD COLUMN transport_mode varchar(10) NOT NULL DEFAULT 'AUTO' COMMENT 'Netty UDP 传输模式：AUTO 优先 Linux EPOLL 否则 NIO；可固定 NIO 或 EPOLL 用于平台兼容验证，不可用的强制模式拒绝启动';
