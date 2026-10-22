-- V41 adds the bounded media download queue; align the V40 policy comments with the active behavior.
ALTER TABLE `biz_telegram_collection_task`
  MODIFY COLUMN `download_images` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否允许服务端按任务策略下载图片二进制；默认关闭',
  MODIFY COLUMN `download_videos` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否允许服务端按任务策略下载视频二进制；默认关闭',
  MODIFY COLUMN `download_documents` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否允许服务端按任务策略下载文件二进制；默认关闭';
