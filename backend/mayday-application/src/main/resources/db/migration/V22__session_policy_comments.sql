-- 服务端会话已支持配置固定期限、无请求期限和并发配额。
-- 本迁移只同步字段说明，保持原类型、NULL约束、默认值、索引和全部会话时间点。
-- 已使用的V1–V21文件不修改；MySQL DDL隐式提交，失败须核查现场，不删除迁移历史。
ALTER TABLE sys_session
  MODIFY COLUMN expires_at TIMESTAMP(6) NOT NULL COMMENT '签发时的固定截止时间，TIMESTAMP 时间点；按会话配置写入，默认 720 分钟，不随认证活动延长',
  MODIFY COLUMN created_at TIMESTAMP(6) NULL DEFAULT NULL COMMENT '会话签发时间点；固定期限亦按当前策略从此时刻计算，缺少可信签发时间的记录不能恢复认证',
  MODIFY COLUMN last_active_at TIMESTAMP(6) NULL DEFAULT NULL COMMENT '最近认证请求时间点，最多每分钟更新一次；无请求超时默认 30 分钟，轮询属于活动；NULL 回退签发时间';
