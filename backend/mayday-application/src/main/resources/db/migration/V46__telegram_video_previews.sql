-- Telegram 点播视频预览任务与经过权限校验的 HLS 资源；源文件继续保留在附件记录中。
CREATE TABLE `biz_telegram_video_preview` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '视频预览任务内部主键，由数据库生成',
  `created_at` DATETIME(6) NOT NULL COMMENT '预览任务进入队列的时间',
  `updated_at` DATETIME(6) NOT NULL COMMENT '预览任务状态最后更新时间',
  `version` BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁版本，避免并行工作器覆盖预览状态',
  `owner_id` BIGINT NOT NULL COMMENT '发起预览的 Mayday 用户 ID，每次访问时复核权限',
  `department_id` BIGINT NULL COMMENT '发起预览时的部门 ID，用于数据范围复核',
  `media_id` BIGINT NOT NULL COMMENT '被处理的 Telegram 视频附件记录 ID；每个原视频最多一个当前预览任务',
  `status` VARCHAR(24) NOT NULL COMMENT '状态：QUEUED、PROCESSING、READY、FAILED、CANCELLED、DELETING 或 EXPIRED',
  `duration_seconds` DECIMAL(12,3) NULL COMMENT 'FFprobe 验证的视频时长秒数；超出服务端限制时拒绝处理',
  `video_codec` VARCHAR(64) NULL COMMENT '探测到的源视频编码名称，仅存技术元数据',
  `audio_codec` VARCHAR(64) NULL COMMENT '探测到的源音频编码名称；无音轨时为空',
  `transcoded` TINYINT(1) NULL COMMENT '是否为浏览器兼容性执行过转码；未探测或失败时为空',
  `failure_message` VARCHAR(256) NULL COMMENT '经过脱敏的预览失败原因，不保存 FFmpeg 原始输出',
  `attempt_count` INT NOT NULL DEFAULT 0 COMMENT '后台预览处理尝试次数，用于限制崩溃后的重试',
  `reserved_bytes` BIGINT NOT NULL DEFAULT 0 COMMENT '任务排队或处理中预留的最大输出空间，READY 后改为 0 并以实际资产字节计量',
  `lease_owner` VARCHAR(36) NULL COMMENT '当前 FFmpeg 工作器的随机租约令牌，用于阻止过期工作器提交结果',
  `lease_expires_at` DATETIME(6) NULL COMMENT '处理租约到期时间，进程崩溃后允许其他实例接管',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz_telegram_preview_media` (`media_id`),
  KEY `idx_biz_telegram_preview_queue` (`status`, `lease_expires_at`, `created_at`),
  KEY `idx_biz_telegram_preview_owner` (`owner_id`, `created_at`),
  CONSTRAINT `fk_biz_telegram_preview_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_biz_telegram_preview_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`),
  CONSTRAINT `fk_biz_telegram_preview_media` FOREIGN KEY (`media_id`) REFERENCES `biz_telegram_media` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 视频点播预览的持久化处理任务与受权状态';

CREATE TABLE `biz_telegram_video_preview_asset` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'HLS 资源内部主键，由数据库生成',
  `created_at` DATETIME(6) NOT NULL COMMENT '预览资源上传到文件存储的时间',
  `updated_at` DATETIME(6) NOT NULL COMMENT '预览资源记录最后更新时间',
  `version` BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁版本，避免资源引用被并行工作器覆盖',
  `preview_id` BIGINT NOT NULL COMMENT '所属视频预览任务 ID',
  `asset_name` VARCHAR(128) NOT NULL COMMENT '由服务端生成的 HLS 清单或分片文件名，不含目录或外部 URL',
  `content_type` VARCHAR(64) NOT NULL COMMENT '经服务端允许列表确定的资源类型：application/vnd.apple.mpegurl 或 video/mp2t',
  `storage_provider` VARCHAR(32) NOT NULL COMMENT '统一文件存储提供方标识，例如 LOCAL 或 S3',
  `storage_key` VARCHAR(128) NOT NULL COMMENT '服务器生成的随机对象键，不含分片名或文件系统路径',
  `actual_size` BIGINT NOT NULL COMMENT '完整写入统一文件存储后的 HLS 资源字节数',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz_telegram_preview_asset_name` (`preview_id`, `asset_name`),
  KEY `idx_biz_telegram_preview_asset_storage` (`storage_provider`, `storage_key`),
  CONSTRAINT `fk_biz_telegram_preview_asset_preview` FOREIGN KEY (`preview_id`) REFERENCES `biz_telegram_video_preview` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 点播 HLS 清单与媒体分片的受控文件存储引用';

-- 队列创建按行锁串行化配额预留，避免不同媒体任务同时通过聚合空间检查。
CREATE TABLE `biz_telegram_video_preview_budget` (
  `id` TINYINT NOT NULL COMMENT '固定单例行主键，唯一允许的值为 1，用于跨实例串行化视频预览配额预留',
  `updated_at` DATETIME(6) NOT NULL COMMENT '最近一次预览任务通过配额检查的时间',
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_biz_telegram_video_preview_budget_singleton` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 视频预览预留配额的跨实例互斥锁行';

INSERT INTO `biz_telegram_video_preview_budget` (`id`, `updated_at`) VALUES (1, CURRENT_TIMESTAMP(6));
