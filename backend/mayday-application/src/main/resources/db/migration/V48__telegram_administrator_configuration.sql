-- Telegram 连接参数由授权管理员在页面维护；所有访问令牌及会话密钥均只保存 AES-256-GCM 密文。
CREATE TABLE `sys_telegram_config` (
  `id` tinyint NOT NULL COMMENT '单例配置主键；固定为 1，不接受客户端指定或创建多个 Telegram 配置',
  `api_id` varchar(10) NOT NULL COMMENT 'Telegram API ID；仅数字公开值，正整数形式由服务校验',
  `api_hash_cipher` text NOT NULL COMMENT 'Telegram API Hash 的 AES-256-GCM 密文；随机 IV 和认证标签包含在密文中，绝不保存明文',
  `session_encryption_key_cipher` text NOT NULL COMMENT 'TDLib 本地会话数据库加密密钥的 AES-256-GCM 密文；应用首次保存时可安全生成，绝不返回浏览器',
  `proxy_enabled` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否让 TDLib 使用本记录维护的网络代理；关闭时不读取代理地址发起连接',
  `proxy_type` varchar(16) NOT NULL DEFAULT 'socks5' COMMENT 'TDLib 支持的代理类型：socks5、http 或 mtproto',
  `proxy_host` varchar(253) NOT NULL DEFAULT '' COMMENT '代理服务器主机名或 IP；不允许包含协议、路径或用户信息',
  `proxy_port` smallint unsigned NOT NULL DEFAULT 0 COMMENT '代理服务器 TCP 端口；启用代理时必须在 1 至 65535 之间',
  `proxy_username` varchar(255) NOT NULL DEFAULT '' COMMENT 'SOCKS5/HTTP 代理可选用户名；不作为接口密钥返回',
  `proxy_password_cipher` text DEFAULT NULL COMMENT 'SOCKS5/HTTP 代理密码的 AES-256-GCM 密文；空值表示未设置',
  `proxy_secret_cipher` text DEFAULT NULL COMMENT 'MTProto 代理 Secret 的 AES-256-GCM 密文；空值表示未设置',
  `updated_by` bigint DEFAULT NULL COMMENT '最近修改配置的后台管理员账号；账号删除后保留配置并清空此引用',
  `created_at` datetime(6) NOT NULL COMMENT '配置首次保存时间；使用 Asia/Shanghai 会话时区和微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '配置最近保存时间；使用 Asia/Shanghai 会话时区和微秒精度',
  PRIMARY KEY (`id`),
  KEY `idx_telegram_config_updated_by` (`updated_by`),
  CONSTRAINT `ck_telegram_config_singleton` CHECK (`id` = 1),
  CONSTRAINT `fk_telegram_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `sys_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 管理员运行配置；API Hash、TDLib 会话密钥和代理口令只存 AES-256-GCM 密文，变更需 telegram:configure 权限';
