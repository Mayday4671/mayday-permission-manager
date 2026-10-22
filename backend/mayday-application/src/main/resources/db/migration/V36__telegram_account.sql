-- 保存单一 Telegram 用户账号的所有者与脱敏状态；TDLib 原始会话始终保存在受控文件系统。
CREATE TABLE `biz_telegram_account`
(
  `id`                  bigint       NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增，不接受客户端指定',
  `account_slot`        varchar(32)  NOT NULL COMMENT '平台账号槽位；首版固定 primary，通过唯一索引保证全库只有一个授权账号',
  `owner_id`            bigint       NOT NULL COMMENT 'Mayday 所有者账号主键；由首次授权的已登录用户赋值，普通请求不可更改',
  `masked_phone_number` varchar(32)           DEFAULT NULL COMMENT '授权手机号脱敏摘要；仅作账号识别，不可用于登录或恢复验证码',
  `telegram_user_id`    bigint                DEFAULT NULL COMMENT 'Telegram 授权用户 ID；仅 TDLib 授权完成后由服务端写入',
  `authorization_state` varchar(40)  NOT NULL COMMENT '最近确认的 TDLib 授权状态枚举；不是实时连接状态，状态由服务端白名单更新',
  `created_at`          datetime(6) NOT NULL COMMENT '记录创建时间；由服务端按 Asia/Shanghai 时区生成',
  `updated_at`          datetime(6) NOT NULL COMMENT '记录更新时间；由服务端按 Asia/Shanghai 时区维护',
  `version`             bigint       NOT NULL DEFAULT 0 COMMENT 'MyBatis-Flex 乐观锁版本；并发修改时拒绝旧状态覆盖',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz_telegram_account_slot` (`account_slot`),
  UNIQUE KEY `uk_biz_telegram_account_user` (`telegram_user_id`),
  KEY `idx_biz_telegram_account_owner` (`owner_id`),
  CONSTRAINT `fk_biz_telegram_account_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Telegram 唯一授权账号的归属摘要；关闭模块或停止连接时保留，敏感会话密钥与 TDLib 数据不入库';
