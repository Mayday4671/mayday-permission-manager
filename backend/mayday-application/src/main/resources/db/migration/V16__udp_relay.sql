-- 单路 UDP 转发持久配置。只保存配置，不保存逐包计数，不自动启动监听，不向普通角色授予权限。
CREATE TABLE `udp_relay_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '固定配置记录主键；当前单路使用 1，不按客户端指定 ID 创建监听',
  `bind_ip` varchar(64) NOT NULL COMMENT '接收绑定 IP；必须为转发服务器本地网卡地址或同地址族通配地址，不是浏览器所在电脑 IP',
  `bind_port` int NOT NULL COMMENT 'UDP 接收端口；允许 1024 至 65535，容器部署须另外映射此 UDP 端口',
  `target_ip` varchar(64) NOT NULL COMMENT '唯一转发目标的单播 IP；不使用域名、组播、广播或通配地址，禁止指向本机相同接收端口',
  `target_port` int NOT NULL COMMENT '唯一转发目标 UDP 端口；允许 1 至 65535，对端必须另行监听并核对接收情况',
  `receive_buffer_mib` int NOT NULL COMMENT '申请内核接收缓冲大小，单位 MiB，范围 1 至 64；实际大小受操作系统上限约束',
  `send_buffer_mib` int NOT NULL COMMENT '申请内核发送缓冲大小，单位 MiB，范围 1 至 64；页面展示实际授予值',
  `pending_memory_mib` int NOT NULL COMMENT '应用待发送缓冲内存上限，单位 MiB，范围 1 至 256；按缓冲容量及额外开销计量，超限计数丢弃',
  `created_at` datetime(6) NOT NULL COMMENT '配置创建时间，服务器 Asia/Shanghai 时区；非数据包到达时间',
  `updated_at` datetime(6) NOT NULL COMMENT '最近配置保存时间；实时统计和启停不触发逐包数据库更新',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；保存和启动需提交当前版本，防止旧页面覆盖或启动过期配置',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='独立 Netty UDP 转发的管理端配置；运行状态和计数仅保留于当前进程，重启默认停止';

INSERT INTO udp_relay_config(id,bind_ip,bind_port,target_ip,target_port,receive_buffer_mib,send_buffer_mib,pending_memory_mib,created_at,updated_at,version)
VALUES(1,'0.0.0.0',19000,'127.0.0.1',19001,16,16,64,NOW(6),NOW(6),0);

INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','UDP 转发','relay','/admin/udp-relay','relay:view',110,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='relay');
