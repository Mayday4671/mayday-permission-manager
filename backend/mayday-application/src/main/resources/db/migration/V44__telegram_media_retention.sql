-- 媒体保留期限到期后删除对象存储正文；EXPIRED 保留安全消息与附件元数据供历史记录查看。
ALTER TABLE `biz_telegram_media`
  MODIFY COLUMN `status` VARCHAR(24) NOT NULL COMMENT '下载状态：QUEUED、DOWNLOADING、AVAILABLE、FAILED、DELETING 或 EXPIRED；EXPIRED 表示正文已按保留策略清理';
