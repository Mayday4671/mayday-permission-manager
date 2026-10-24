CREATE TABLE `sys_telegram_media_policy` (
  `id` bigint NOT NULL COMMENT '媒体策略单例主键，固定为 1',
  `max_file_bytes` bigint DEFAULT NULL COMMENT '单文件字节上限，0 不单独限制，NULL 使用部署默认值',
  `max_stored_bytes` bigint DEFAULT NULL COMMENT 'Telegram 原始媒体总存储容量，单位字节',
  `download_timeout_seconds` int DEFAULT NULL COMMENT '单次附件下载最长等待秒数',
  `updated_by` bigint DEFAULT NULL COMMENT '最近修改策略的管理员编号',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '策略最近更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 媒体容量与下载时限策略，独立于账号凭据';
INSERT INTO `sys_telegram_media_policy` (`id`) VALUES (1);

ALTER TABLE `biz_telegram_media` ADD COLUMN `reserved_bytes` bigint DEFAULT NULL COMMENT '本次下载独占预留容量，启动传输前确定，完成或失败后不计入容量' AFTER `expected_size`;

ALTER TABLE `biz_telegram_media`
 ADD COLUMN `download_ticket_hash` varchar(64) DEFAULT NULL COMMENT '浏览器原文件下载能力票据的 SHA-256 摘要，不保存明文' AFTER `stream_ticket_expires_at`,
 ADD COLUMN `download_ticket_expires_at` datetime(6) DEFAULT NULL COMMENT '原文件下载票据失效时间，与视频播放票据独立' AFTER `download_ticket_hash`;
