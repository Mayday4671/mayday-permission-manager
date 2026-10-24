-- Split Telegram search turns into persistent, owner-scoped conversation sessions.
-- Existing searches are preserved and grouped by owner plus captured department so
-- a department data-scope boundary is never widened by the backfill.
CREATE TABLE `biz_telegram_conversation` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '会话主键，由数据库生成',
  `created_at` DATETIME(6) NOT NULL COMMENT '会话首次创建时间，用于稳定展示历史顺序',
  `updated_at` DATETIME(6) NOT NULL COMMENT '会话最近一次提交关键词的时间，用于侧栏排序',
  `version` BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁版本，避免并发搜索覆盖会话摘要',
  `owner_id` BIGINT NOT NULL COMMENT '创建会话的 Mayday 用户 ID，决定会话资源所有权',
  `department_id` BIGINT NULL COMMENT '创建时所属部门 ID，用于保持平台配置的数据范围边界',
  `title` VARCHAR(120) NOT NULL COMMENT '侧栏会话标题；首次搜索后由首个关键词生成',
  `last_keyword` VARCHAR(256) NULL COMMENT '最近一次实际提交给已验证机器人的关键词预览',
  `search_count` INT NOT NULL DEFAULT 0 COMMENT '此会话包含的搜索轮数，不代表 Telegram 返回消息数',
  PRIMARY KEY (`id`),
  KEY `idx_biz_telegram_conversation_owner_updated` (`owner_id`, `updated_at`, `id`),
  KEY `idx_biz_telegram_conversation_department` (`department_id`),
  CONSTRAINT `fk_biz_telegram_conversation_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_biz_telegram_conversation_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Mayday Telegram 搜索会话；每个会话包含多轮搜索，按用户及部门数据范围隔离';

-- Add the nullable relation first so existing rows can be assigned before the
-- column is made mandatory for all current and future search turns.
ALTER TABLE `biz_telegram_search`
  ADD COLUMN `conversation_id` BIGINT NULL COMMENT '所属 Mayday Telegram 会话；多轮搜索共享同一会话' AFTER `department_id`;

-- Preserve old history as one session per owner and captured department.
INSERT INTO `biz_telegram_conversation`
  (`owner_id`, `department_id`, `title`, `last_keyword`, `search_count`, `created_at`, `updated_at`, `version`)
SELECT `owner_id`, `department_id`, '历史会话', NULL, COUNT(*), MIN(`created_at`), MAX(`updated_at`), 0
FROM `biz_telegram_search`
GROUP BY `owner_id`, `department_id`;

-- Copy the latest search term into the sidebar preview without exposing it in logs.
UPDATE `biz_telegram_conversation` AS `conversation`
SET `conversation`.`last_keyword` = (
  SELECT `search`.`keyword`
  FROM `biz_telegram_search` AS `search`
  WHERE `search`.`owner_id` = `conversation`.`owner_id`
    AND `search`.`department_id` <=> `conversation`.`department_id`
  ORDER BY `search`.`id` DESC
  LIMIT 1
);

-- Assign each search only to the matching owner and department group.
UPDATE `biz_telegram_search` AS `search`
JOIN `biz_telegram_conversation` AS `conversation`
  ON `conversation`.`owner_id` = `search`.`owner_id`
  AND `conversation`.`department_id` <=> `search`.`department_id`
SET `search`.`conversation_id` = `conversation`.`id`;

ALTER TABLE `biz_telegram_search`
  MODIFY COLUMN `conversation_id` BIGINT NOT NULL COMMENT '所属 Mayday Telegram 会话；多轮搜索共享同一会话',
  ADD KEY `idx_biz_telegram_search_conversation` (`conversation_id`, `id`),
  ADD CONSTRAINT `fk_biz_telegram_search_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `biz_telegram_conversation` (`id`);
