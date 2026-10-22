-- AgentScope Java 2.0.4 的独立持久化模块；状态存储表结构遵循官方 MySQL JDBC 扩展。
-- 会话正文保存在带用户外键的业务表；官方状态表以 userId/sessionId 复合命名空间隔离。
CREATE TABLE `ai_agent_conversation` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '会话记录主键；数据库自增编号，仅用于平台内部关联',
  `created_at` datetime(6) NOT NULL COMMENT '会话创建时间；由应用填充，北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '会话最近更新时间；由应用填充，北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；服务端并发保护字段，不接受客户端修改',
  `owner_id` bigint NOT NULL COMMENT '会话所有者 sys_user.id；只能由登录账号决定，账号删除时级联清理',
  `session_id` varchar(36) NOT NULL COMMENT '服务端生成的 UUID；作为 AgentScope 状态会话标识，不向前端返回',
  `title` varchar(120) NOT NULL COMMENT '根据首条用户消息生成的会话标题；最多 60 个字符，不作为授权依据',
  `processing_token` varchar(36) DEFAULT NULL COMMENT '当前模型请求的 UUID 租约；用于跨实例串行化和迟到结果隔离',
  `processing_request_id` varchar(36) DEFAULT NULL COMMENT '当前租约对应的客户端幂等 UUID；用于崩溃恢复和清理过期消息',
  `processing_started_at` datetime(6) DEFAULT NULL COMMENT '处理租约开始时间；超出服务端期限可被后续请求安全接管',
  `last_message_at` datetime(6) DEFAULT NULL COMMENT '最近一轮成功对话时间；无成功消息的空会话为 NULL',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_agent_session` (`session_id`),
  KEY `idx_ai_agent_owner_updated` (`owner_id`,`updated_at`,`id`),
  KEY `idx_ai_agent_processing` (`processing_token`),
  CONSTRAINT `fk_ai_agent_conversation_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AgentScope 私有会话目录；所有查询以所有者为边界，删除账号时清除会话目录';

CREATE TABLE `ai_agent_message` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '消息记录主键；按主键顺序恢复同一会话的聊天时间线',
  `created_at` datetime(6) NOT NULL COMMENT '消息写入时间；由应用填充，北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '消息最后更新时间；由应用填充，北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；服务端并发保护字段，不接受客户端修改',
  `conversation_id` bigint NOT NULL COMMENT '所属会话 ai_agent_conversation.id；删除会话时级联删除消息',
  `role` varchar(16) NOT NULL COMMENT '消息角色；仅允许服务端写入 USER 或 ASSISTANT',
  `content` longtext NOT NULL COMMENT '纯文本消息正文；按角色权限读取，前端不解析为 HTML',
  `status` varchar(16) NOT NULL COMMENT '消息状态；PROCESSING/COMPLETE/FAILED，只有 COMPLETE 进入上下文',
  `turn_token` varchar(36) NOT NULL COMMENT '本轮客户端幂等 UUID；同一会话和角色组合唯一，用于安全处理重试',
  PRIMARY KEY (`id`),
  KEY `idx_ai_agent_message_conversation` (`conversation_id`,`id`),
  UNIQUE KEY `uq_ai_agent_message_turn_role` (`conversation_id`,`turn_token`,`role`),
  CONSTRAINT `fk_ai_agent_message_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `ai_agent_conversation` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AgentScope 会话纯文本消息及处理状态；只用成功轮次恢复模型上下文';

CREATE TABLE `ai_agent_state` (
  `session_id` varchar(255) NOT NULL COMMENT 'AgentScope 状态分区键；内部格式为登录用户 ID 与会话 UUID 的组合',
  `state_key` varchar(255) NOT NULL COMMENT 'AgentScope 状态对象稳定键；由官方 JDBC 状态扩展管理',
  `item_index` int NOT NULL DEFAULT 0 COMMENT '同一状态键下的列表位置；官方状态扩展管理，单对象默认为 0',
  `state_data` longtext NOT NULL COMMENT 'AgentScope 序列化状态 JSON；仅服务端可读，不包含模型密钥',
  `version` bigint NOT NULL DEFAULT 0 COMMENT '官方 JDBC 扩展的状态版本；用于原子乐观并发控制',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '状态行首次保存时间；由 MySQL 生成，遵循会话北京时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '状态行最近保存时间；由 MySQL 更新，遵循会话北京时间',
  PRIMARY KEY (`session_id`,`state_key`,`item_index`),
  KEY `idx_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AgentScope Java 官方 JDBC 会话状态；持久化到 MySQL 以支持重启和多实例';
