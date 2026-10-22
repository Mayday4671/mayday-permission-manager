-- Shared Telegram account visibility follows the recorded owner's department scope.
ALTER TABLE `biz_telegram_account`
  ADD COLUMN `department_id` BIGINT NULL COMMENT '创建账号槽位时所有者的部门 ID，用于管理员角色的数据范围校验' AFTER `owner_id`,
  ADD KEY `idx_biz_telegram_account_department` (`department_id`),
  ADD CONSTRAINT `fk_biz_telegram_account_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`);
