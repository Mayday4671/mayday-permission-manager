-- Existing collection tasks retain their original download behavior.
ALTER TABLE biz_telegram_collection_task
    ADD COLUMN preview_only TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否为按需播放预览；1 时原生视频只登记远端媒体并按浏览器 Range 分段读取，0 保持完整附件采集';
