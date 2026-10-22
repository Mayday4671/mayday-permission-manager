-- 原生浏览器视频播放器通过短时、媒体级播放票据执行 Range 请求，不把后台登录令牌放入 URL。
ALTER TABLE `biz_telegram_media`
  ADD COLUMN `stream_ticket_hash` CHAR(64) NULL COMMENT '短时播放能力令牌的 SHA-256 摘要；原始令牌仅返回已授权浏览器一次',
  ADD COLUMN `stream_ticket_expires_at` DATETIME(6) NULL COMMENT '短时播放能力令牌的过期时间；每次字节范围请求都会复核所有者当前权限';
