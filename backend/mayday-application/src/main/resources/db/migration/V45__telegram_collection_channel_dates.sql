-- Add explicit, bounded channel sources and inclusive business-date filters to Telegram collection tasks.
ALTER TABLE `biz_telegram_collection_task`
  MODIFY COLUMN `message_link` VARCHAR(2048) NULL COMMENT '用户提供的 HTTPS Telegram 消息链接；频道来源任务为空，真实 chat/message 由 TDLib 验证',
  ADD COLUMN `source_title` VARCHAR(255) NULL COMMENT 'TDLib 验证的采集来源名称；频道来源为频道名，消息链接来源为空',
  ADD COLUMN `from_date` DATE NULL COMMENT '可选的包含式最早采集日期；按系统业务时区解释，空值表示不限制开始日期',
  ADD COLUMN `to_date` DATE NULL COMMENT '可选的包含式最晚采集日期；按系统业务时区解释，空值表示不限制结束日期',
  ADD COLUMN `scanned_messages` INT NOT NULL DEFAULT 0 COMMENT '已检查的频道/来源消息数，包含因日期筛选而略过的记录；每任务硬上限 5000';
