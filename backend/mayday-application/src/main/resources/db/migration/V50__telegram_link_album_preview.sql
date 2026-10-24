-- Persist the explicit album-preview boundary so a queued task keeps the same
-- source scope after a worker or application restart. Existing history tasks
-- remain unchanged; their default is still backward history pagination.
ALTER TABLE `biz_telegram_collection_task`
  ADD COLUMN `include_album` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否仅采集所选链接消息及同聊天同相册的相邻成员；0 保持普通历史分页，1 最多读取 10 条同组消息后结束且不得扩展到其他帖子'
    AFTER `message_link`;
