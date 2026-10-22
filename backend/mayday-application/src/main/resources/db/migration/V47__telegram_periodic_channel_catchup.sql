-- Persist a separate, bounded periodic catch-up cursor without changing the history backfill checkpoint.
ALTER TABLE `biz_telegram_collection_task`
  ADD COLUMN `tracking_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '用户是否显式启用频道定期追赶；绝不代表 Telegram 推送监听或自动加入频道',
  ADD COLUMN `live_cursor_message_id` VARCHAR(32) NULL COMMENT '频道最新追赶游标，与向旧历史回填使用的 cursor_message_id 分开保存',
  ADD COLUMN `live_scanned_messages` INT NOT NULL DEFAULT 0 COMMENT '频道定期追赶累计检查的消息数；达到服务端硬上限后自动停止',
  ADD COLUMN `live_checked_at` DATETIME(6) NULL COMMENT '最近一次向 Telegram 检查频道最新消息的时间',
  ADD COLUMN `live_status_message` VARCHAR(256) NULL COMMENT '定期追赶状态说明；明确展示定期拉取模式和停止原因',
  ADD COLUMN `live_lease_owner` VARCHAR(36) NULL COMMENT '追赶工作器独立租约令牌；不与历史回填任务租约共用',
  ADD COLUMN `live_lease_expires_at` DATETIME(6) NULL COMMENT '追赶工作器租约过期时间，进程退出后可恢复',
  ADD KEY `idx_biz_telegram_collection_tracking` (`tracking_enabled`, `status`, `live_lease_expires_at`, `updated_at`);
