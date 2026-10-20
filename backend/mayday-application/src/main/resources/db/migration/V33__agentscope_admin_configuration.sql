-- AgentScope 运维配置独立保存；API 密钥只存 AES-256-GCM 密文，部署主密钥留在服务端。
CREATE TABLE `sys_agentscope_config`
(
  `id`                      tinyint       NOT NULL COMMENT '单例配置主键；固定为 1，不接受客户端指定或创建多个模型配置',
  `api_key_cipher`          text                   DEFAULT NULL COMMENT 'DashScope API 密钥 AES-256-GCM 密文；随机 IV 与认证标签包含在密文中，绝不保存明文',
  `model`                   varchar(120)  NOT NULL DEFAULT 'dashscope:qwen-plus' COMMENT '固定 DashScope 提供方下的模型注册标识；仅允许 dashscope 前缀和安全字符',
  `request_timeout_seconds` smallint      NOT NULL DEFAULT 120 COMMENT '单次模型调用超时秒数；后台配置限于 10 至 300 秒',
  `max_message_length`      smallint      NOT NULL DEFAULT 4000 COMMENT '单条用户消息字符上限；后台配置限于 1 至 4000 个字符',
  `max_context_messages`    smallint      NOT NULL DEFAULT 40 COMMENT '每次调用恢复的最大历史消息条数；后台配置限于 2 至 100，运行时按完整问答轮次取偶数',
  `system_prompt`           varchar(4000) NOT NULL DEFAULT '你是 Mayday 工作空间中的通用助手。请以中文清晰、准确地回答问题；你无法访问平台业务数据或执行外部操作，遇到超出上下文的信息时应如实说明。' COMMENT '管理员设置的模型系统提示词；消息正文仍按纯文本处理且不注入平台业务数据',
  `updated_by`              bigint                 DEFAULT NULL COMMENT '最近保存该配置的本地管理员账号；账号删除后保留配置并清空此引用',
  `created_at`              datetime(6) NOT NULL COMMENT '配置首次保存时间；由服务端按 Asia/Shanghai 时区生成',
  `updated_at`              datetime(6) NOT NULL COMMENT '配置最近保存时间；由服务端按 Asia/Shanghai 时区生成',
  PRIMARY KEY (`id`),
  KEY                       `idx_agentscope_config_updated_by` (`updated_by`),
  CONSTRAINT `ck_agentscope_config_singleton` CHECK (`id` = 1),
  CONSTRAINT `fk_agentscope_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `sys_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='智能体受控运维配置；密钥仅密文落库、读取接口仅暴露是否已配置，变更需 agentscope:configure 权限';
