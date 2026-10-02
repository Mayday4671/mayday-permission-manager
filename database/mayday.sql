-- ============================================================================
-- Mayday 数据库完整初始化脚本（MySQL 8.4，结构版本 V20）
-- 唯一对外交付 SQL：48 张业务表、483 个业务字段、索引/外键及必要基础资料。
-- 表和字段的中文 COMMENT 是字段字典；无需额外说明文件。
-- ============================================================================
-- 【使用方法】
-- 1. 先创建独立空库，字符集 utf8mb4，排序规则 utf8mb4_0900_ai_ci。
--    示例：CREATE DATABASE mayday CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- 2. 选择该空库后一次执行本文件。命令行示例（-p 交互输入密码，不写进脚本）：
--    mysql --default-character-set=utf8mb4 -u 用户名 -p 数据库名 < database/mayday.sql
--    数据库客户端必须设置“遇到错误停止”，禁止使用 mysql --force。
-- 3. 配置应用 DB_URL/DB_USERNAME/DB_PASSWORD 和独立 ADMIN_PASSWORD，再启动后端。
--    默认 SEED_DEMO_DATA=false：应用创建 admin 及管理员角色、补全菜单/字典/分类。
--    管理员密码由应用 BCrypt 加密；本 SQL 不包含固定密码、个人数据或演示文章。
-- 4. 本文件已包含 V20 的 Flyway BASELINE 标记，应用可正常校验并继续执行 V21+。
--    不需要关闭 Flyway、打开 baseline-on-migrate 或修改历史迁移文件。
-- 【适用范围】仅首次空库安装。已有业务库使用程序内部增量迁移，不重复导入本文件。
-- 本脚本没有 DROP/TRUNCATE 业务表，也不会覆盖已有账号。MySQL DDL 隐式提交，
-- 中断后需核查新建测试库再重试，不保证整份 SQL 事务回滚。
-- 【字段约定】DATETIME 业务时间采用 Asia/Shanghai；TIMESTAMP 保存时间点。
-- version 为 JPA 乐观锁，不是文章修订号；逻辑关联由服务层校验，物理外键见 CONSTRAINT。
-- 【维护方式】以后新增结构先写下一份迁移，再同步本文件的结构/基础资料/基线版本。
-- node scripts/database-docs.mjs --check 可核对本文件与运行库的中文注释。
-- 历史 V12 注释中的 catalog/字典路径已合并到本文件；旧迁移保持原样以保留校验和。

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- 空库保护：存在任意已有表/视图就报错；不使用 IF NOT EXISTS 掩盖重复导入。
-- 临时表只存在于当前连接，失败后断开连接会自动清理，不写入业务库结构。
CREATE TEMPORARY TABLE mayday_empty_database_guard (
  existing_tables INT NOT NULL,
  CONSTRAINT mayday_requires_empty_database CHECK (existing_tables = 0)
);
INSERT INTO mayday_empty_database_guard
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();
DROP TEMPORARY TABLE mayday_empty_database_guard;

-- sys_entry 与 sys_user 存在双向引用，建空表时暂缓外键检查，建表后立即恢复。
-- 仅修改当前连接的设置，不修改数据库全局变量；基础数据在恢复检查后插入。
SET @mayday_original_foreign_key_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;

-- 内容主记录及发布状态；当前草稿和线上内容通过不同修订指针隔离，公开查询不读旧正文列
CREATE TABLE `cms_notice` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `title` varchar(160) NOT NULL COMMENT '旧版兼容标题；当前展示以 draft_revision_id 或 live_revision_id 指向的修订为准',
  `category` varchar(32) NOT NULL COMMENT '旧版兼容分类名称；当前分类关系使用 cms_revision.category_id',
  `summary` varchar(500) DEFAULT NULL COMMENT '旧版兼容摘要；不是当前线上内容的权威来源',
  `content` text NOT NULL COMMENT '旧版兼容正文；新内容正文保存在不可变 cms_revision 中',
  `published` tinyint(1) NOT NULL COMMENT '旧版兼容发布标记；公开可见性必须同时检查线上修订、删除状态、可见性及下线时间',
  `author_id` bigint NOT NULL COMMENT '内容所有者账号 ID，逻辑关联 sys_user.id；参与本人数据范围判断',
  `department_id` bigint DEFAULT NULL COMMENT '所属部门 ID，外键 sys_entry.id；与作者共同决定内容数据范围',
  `author_name` varchar(64) DEFAULT NULL COMMENT '作者显示名快照；保留历史，不随账号昵称自动改写',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间；NULL 表示不在回收站，非 NULL 禁止公开，恢复不自动重新发布',
  `draft_revision_id` bigint DEFAULT NULL COMMENT '当前编辑修订 ID，逻辑关联 cms_revision.id；必须属于本文章',
  `live_revision_id` bigint DEFAULT NULL COMMENT '当前线上修订 ID，逻辑关联 cms_revision.id；NULL 表示未上线，不能用草稿代替',
  `draft_status` varchar(24) NOT NULL DEFAULT 'DRAFT' COMMENT '当前修订状态摘要：DRAFT/PENDING/APPROVED/REJECTED/PUBLISHED 等，由内容与审核服务维护',
  `requires_approval` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否要求修订经过审批才能发布；与系统 content.requireApproval 配置共同校验',
  `published_at` datetime(6) DEFAULT NULL COMMENT '最近一次上线时间；北京时间 DATETIME，公开列表排序与展示使用',
  `live_offline_at` datetime(6) DEFAULT NULL COMMENT '当前线上修订计划下线时间；NULL 表示无到期时间，公开查询同时检查时效',
  `scheduled_revision_id` bigint DEFAULT NULL COMMENT '待定时发布的修订 ID，逻辑关联 cms_revision；不是实时草稿引用',
  `scheduled_publish_at` datetime(6) DEFAULT NULL COMMENT '计划上线时间，北京时间；NULL 表示无待执行上线任务',
  `scheduled_offline_at` datetime(6) DEFAULT NULL COMMENT '定时发布时附带的计划下线时间；上线后转入 live_offline_at',
  `scheduled_actor_id` bigint DEFAULT NULL COMMENT '设置排期的账号 ID；执行时重新检查该账号状态、发布权限和内容范围',
  `schedule_error` varchar(500) DEFAULT NULL COMMENT '最近排期失败原因；用于后台排查，不通过门户公开',
  `view_count` bigint NOT NULL DEFAULT '0' COMMENT '公开阅读计数；仅统计通过公开可见性检查的阅读上报，不用于权限判断',
  PRIMARY KEY (`id`),
  KEY `idx_notice_published` (`published`,`created_at`),
  KEY `idx_notice_author` (`author_id`),
  KEY `idx_notice_department` (`department_id`),
  KEY `idx_notice_deleted` (`deleted_at`),
  CONSTRAINT `fk_notice_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='内容主记录及发布状态；当前草稿和线上内容通过不同修订指针隔离，公开查询不读旧正文列';

-- V3 旧版内容标签兼容表；V9 已迁移为稳定标签 ID，保留用于升级追溯，不作为新修订标签来源
CREATE TABLE `cms_notice_tag` (
  `notice_id` bigint NOT NULL COMMENT '旧内容 ID，外键 cms_notice.id',
  `tag` varchar(32) NOT NULL COMMENT '旧版标签名称；升级时映射为 sys_entry(kind=tags) 的稳定 ID',
  PRIMARY KEY (`notice_id`,`tag`),
  CONSTRAINT `cms_notice_tag_ibfk_1` FOREIGN KEY (`notice_id`) REFERENCES `cms_notice` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='V3 旧版内容标签兼容表；V9 已迁移为稳定标签 ID，保留用于升级追溯，不作为新修订标签来源';

-- 内容发布历史；记录上线修订及下线信息，与草稿编辑历史分离
CREATE TABLE `cms_publication` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `notice_id` bigint NOT NULL COMMENT '内容 ID，外键 cms_notice.id，永久删除文章时级联清理',
  `revision_id` bigint NOT NULL COMMENT '实际发布的修订 ID，外键 cms_revision.id',
  `published_at` datetime(6) NOT NULL COMMENT '本次上线时间，北京时间；不是修订创建时间',
  `offline_at` datetime(6) DEFAULT NULL COMMENT '本次发布结束时间，NULL 表示未记录下线；公开判断仍以主记录线上指针为准',
  `operator_name` varchar(64) DEFAULT NULL COMMENT '发布或下线操作人显示名快照',
  `reason` varchar(100) DEFAULT NULL COMMENT '发布/下线原因或来源，例如手动操作、定时发布、旧版迁移',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  KEY `notice_id` (`notice_id`),
  KEY `revision_id` (`revision_id`),
  CONSTRAINT `cms_publication_ibfk_1` FOREIGN KEY (`notice_id`) REFERENCES `cms_notice` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cms_publication_ibfk_2` FOREIGN KEY (`revision_id`) REFERENCES `cms_revision` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='内容发布历史；记录上线修订及下线信息，与草稿编辑历史分离';

-- 内容不可变修订；每次编辑新增版本，审批仅批准绑定修订，不自动批准后续改稿
CREATE TABLE `cms_revision` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `notice_id` bigint NOT NULL COMMENT '所属内容 ID，外键 cms_notice.id；永久删除内容时级联删除修订',
  `revision_number` int NOT NULL COMMENT '文章内递增修订号，与 notice_id 联合唯一；区别于 JPA version',
  `title` varchar(160) NOT NULL COMMENT '本次修订标题；公开接口只读取线上修订标题',
  `category_id` bigint NOT NULL COMMENT '稳定分类 ID，外键 sys_entry.id 且 kind=categories；引用中不能删除分类',
  `summary` varchar(500) DEFAULT NULL COMMENT '内容摘要，可为空；用于列表和搜索结果展示',
  `content` text NOT NULL COMMENT '经后端富文本白名单清理的 HTML 正文；前端阅读时再次过滤',
  `visibility` varchar(24) NOT NULL DEFAULT 'PUBLIC' COMMENT '可见性：PUBLIC 可公开或 INTERNAL 内部；即使有线上指针，内部修订也不能匿名读取',
  `cover_id` bigint DEFAULT NULL COMMENT '封面文件 ID，外键 ops_file.id；允许 NULL，公开读取时再次校验文章可见性及图片格式',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '内容排序权重；门户按业务排序逻辑使用，不影响授权',
  `pinned` tinyint(1) NOT NULL DEFAULT '0' COMMENT '置顶标记：1 在门户排序优先，但不能绕过发布或可见性检查',
  `recommended` tinyint(1) NOT NULL DEFAULT '0' COMMENT '推荐标记：1 可被推荐筛选命中；不等于已发布',
  `seo_title` varchar(160) DEFAULT NULL COMMENT '本修订 SEO 页面标题；为空时使用内容标题',
  `seo_keywords` varchar(250) DEFAULT NULL COMMENT '本修订 SEO 关键词；作为文本元信息，不执行 HTML',
  `seo_description` varchar(500) DEFAULT NULL COMMENT '本修订 SEO 描述；作为文本元信息',
  `approval_status` varchar(24) NOT NULL DEFAULT 'DRAFT' COMMENT '审批状态：DRAFT/PENDING/APPROVED/REJECTED/WITHDRAWN；状态只授权本修订，不代表已经上线',
  `approval_request_id` bigint DEFAULT NULL COMMENT '绑定的审批实例 ID，逻辑关联 ops_flow_request.id；审批完成校验双向业务绑定',
  `editor_id` bigint DEFAULT NULL COMMENT '创建本修订的账号 ID，逻辑关联 sys_user.id；不是内容所有者字段',
  `editor_name` varchar(64) DEFAULT NULL COMMENT '修订编辑人昵称快照；账号后续改名不追写历史',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `notice_id` (`notice_id`,`revision_number`),
  KEY `category_id` (`category_id`),
  KEY `cover_id` (`cover_id`),
  CONSTRAINT `cms_revision_ibfk_1` FOREIGN KEY (`notice_id`) REFERENCES `cms_notice` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cms_revision_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `sys_entry` (`id`),
  CONSTRAINT `cms_revision_ibfk_3` FOREIGN KEY (`cover_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='内容不可变修订；每次编辑新增版本，审批仅批准绑定修订，不自动批准后续改稿';

-- 修订可下载附件关联；文件公开资格来自已上线修订，不来自文件中心的上传状态
CREATE TABLE `cms_revision_file` (
  `revision_id` bigint NOT NULL COMMENT '修订 ID，外键 cms_revision.id，随修订删除级联清理',
  `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；被修订引用时禁止文件中心删除',
  PRIMARY KEY (`revision_id`,`file_id`),
  KEY `file_id` (`file_id`),
  CONSTRAINT `cms_revision_file_ibfk_1` FOREIGN KEY (`revision_id`) REFERENCES `cms_revision` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cms_revision_file_ibfk_2` FOREIGN KEY (`file_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='修订可下载附件关联；文件公开资格来自已上线修订，不来自文件中心的上传状态';

-- 修订与稳定标签 ID 的多对多快照；修改草稿不会改变线上修订标签
CREATE TABLE `cms_revision_tag` (
  `revision_id` bigint NOT NULL COMMENT '修订 ID，外键 cms_revision.id，随修订删除级联清理',
  `tag_id` bigint NOT NULL COMMENT '标签 ID，外键 sys_entry.id 且 kind=tags；引用中不能删除',
  PRIMARY KEY (`revision_id`,`tag_id`),
  KEY `tag_id` (`tag_id`),
  CONSTRAINT `cms_revision_tag_ibfk_1` FOREIGN KEY (`revision_id`) REFERENCES `cms_revision` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cms_revision_tag_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='修订与稳定标签 ID 的多对多快照；修改草稿不会改变线上修订标签';

-- 通知对单个账号的投递及阅读状态；通知与收件人联合唯一，接收快照不随组织变更漂移
CREATE TABLE `ops_delivery` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `notification_id` bigint NOT NULL COMMENT '发布通知 ID，外键 ops_notification.id，随通知删除级联清理',
  `recipient_id` bigint NOT NULL COMMENT '收件人账号 ID，逻辑关联 sys_user.id；查询必须等于当前会话账号',
  `recipient_name` varchar(64) NOT NULL COMMENT '发布时收件人昵称快照；保留当时接收记录',
  `read_at` datetime(6) DEFAULT NULL COMMENT '首次阅读时间；NULL 表示未读，标记已读只能作用于自己的投递',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `notification_id` (`notification_id`,`recipient_id`),
  KEY `idx_delivery_recipient` (`recipient_id`,`read_at`),
  CONSTRAINT `ops_delivery_ibfk_1` FOREIGN KEY (`notification_id`) REFERENCES `ops_notification` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知对单个账号的投递及阅读状态；通知与收件人联合唯一，接收快照不随组织变更漂移';

-- 审批通知可靠投递事件；随业务事务写入，后台工作器单独投递并支持退避重试
CREATE TABLE `ops_event` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `event_key` varchar(160) NOT NULL COMMENT '业务事件去重键，唯一；同时传入通知 event_key 防止重试重复投递',
  `request_id` bigint NOT NULL COMMENT '关联审批实例 ID，逻辑关联 ops_flow_request.id',
  `recipient_id` bigint NOT NULL COMMENT '目标收件账号 ID，逻辑关联 sys_user.id；按生成事件时的业务决定保存',
  `title` varchar(160) NOT NULL COMMENT '通知标题快照',
  `body` varchar(1000) NOT NULL COMMENT '通知文本摘要，最多 1000 字；不存任意可执行脚本',
  `status` varchar(16) NOT NULL DEFAULT 'PENDING' COMMENT '投递状态：PENDING 待投递或等待重试、DELIVERED 已投递、SKIPPED 接收账号已删除',
  `attempts` int NOT NULL DEFAULT '0' COMMENT '失败尝试计数，初始 0、最大记录 10000；指数退避最多一小时，当前持续重试而非达次数终止',
  `next_attempt_at` datetime(6) NOT NULL COMMENT '下一次允许尝试的北京时间；工作器按状态和时间领取',
  `last_error` varchar(500) DEFAULT NULL COMMENT '最近失败信息摘要，最多 500 字；后台 manage 权限可查看，不向普通收件人暴露',
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_key` (`event_key`),
  KEY `idx_event_retry` (`status`,`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批通知可靠投递事件；随业务事务写入，后台工作器单独投递并支持退避重试';

-- 文件元数据；文件正文独立存入 ops_file_payload，下载逐次校验所有权或业务访问资格
CREATE TABLE `ops_file` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `name` varchar(255) NOT NULL COMMENT '去除目录部分及控制字符后的原始文件名；不能用作服务器路径',
  `content_type` varchar(128) NOT NULL COMMENT '响应内容类型；普通附件统一 application/octet-stream，图片封面另做格式检查',
  `size` bigint NOT NULL COMMENT '文件字节数；当前上传限制为 1 字节至 10 MB',
  `owner_id` bigint DEFAULT NULL COMMENT '上传者账号 ID，逻辑关联 sys_user.id；NULL 为旧数据，不自动视为公共文件',
  `owner_name` varchar(64) DEFAULT NULL COMMENT '上传者昵称快照；展示用，不作为授权依据',
  `directory_id` bigint DEFAULT NULL COMMENT '所属文件目录ID；NULL表示当前所有者的根目录，移动时服务端校验目录所有权',
  `storage_provider` varchar(16) NOT NULL DEFAULT 'MYSQL' COMMENT '正文存储适配器：MYSQL兼容旧记录、LOCAL本地持久目录、S3兼容对象存储；创建后不可由客户端改写',
  `storage_key` varchar(512) DEFAULT NULL COMMENT '服务端生成的正文对象键；旧MYSQL记录为空，不作为公共下载地址或返回前端',
  `thumbnail_key` varchar(512) DEFAULT NULL COMMENT '服务端生成的安全图片缩略图键；不支持缩略图或旧文件为NULL，前端通过鉴权接口访问',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '移入回收站的服务器时间；NULL表示正常文件，业务引用中的文件禁止回收',
  `purge_requested_at` datetime(6) DEFAULT NULL COMMENT '申请永久删除时间；仅回收文件可申请，由后台先清理外部正文再删除元信息，可失败重试',
  `purge_error` varchar(300) DEFAULT NULL COMMENT '外部存储清理失败的脱敏提示；正文未成功删除时保留元信息，不向页面泄漏凭据或对象路径',
  PRIMARY KEY (`id`),
  KEY `idx_file_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='文件元数据；文件正文独立存入 ops_file_payload，下载逐次校验所有权或业务访问资格';

-- 文件二进制正文；与元数据一对一，数据库备份需同时包含此表
CREATE TABLE `ops_file_payload` (
  `id` bigint NOT NULL COMMENT '文件主键，同时为 ops_file.id 外键；不自增',
  `data` longblob NOT NULL COMMENT '原始二进制内容 LONGBLOB；下载采用附件响应，不把上传内容作为页面执行',
  PRIMARY KEY (`id`),
  CONSTRAINT `ops_file_payload_ibfk_1` FOREIGN KEY (`id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='文件二进制正文；与元数据一对一，数据库备份需同时包含此表';

-- 审批操作及字段变更历史；保留人员节点快照，不反向授予历史操作人当前处理权
CREATE TABLE `ops_flow_decision` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `request_id` bigint DEFAULT NULL COMMENT '审批实例 ID，逻辑关联 ops_flow_request.id',
  `actor_id` bigint DEFAULT NULL COMMENT '操作账号 ID，逻辑关联 sys_user.id',
  `actor_name` varchar(64) DEFAULT NULL COMMENT '操作人昵称快照',
  `action` varchar(20) DEFAULT NULL COMMENT '操作类型：SUBMIT/APPROVE/REJECT/WITHDRAW/COMMENT/TRANSFER/ADD_SIGN 等服务端定义值',
  `comment` varchar(500) DEFAULT NULL COMMENT '审批意见或操作说明，最多 500 字',
  `node_id` varchar(40) DEFAULT NULL COMMENT '操作节点的模型 ID；发起或整体操作可为空',
  `node_name` varchar(80) DEFAULT NULL COMMENT '操作时节点名称快照',
  `target_user_id` bigint DEFAULT NULL COMMENT '转交或加签目标账号 ID，逻辑关联 sys_user.id；其他动作可为空',
  `target_user_name` varchar(64) DEFAULT NULL COMMENT '转交/加签目标昵称快照',
  `changes_json` longtext COMMENT '字段修改前后值 JSON；历史返回时按读取者可见字段过滤，禁止直接整列公开',
  `run_number` INT NOT NULL DEFAULT 1 COMMENT '决定所属提交轮次；重提不覆盖以前的处理轨迹',
  `node_visit` INT NOT NULL DEFAULT 0 COMMENT '决定所属节点办理批次；进入下一节点前的决定归属于原任务批次',
  `target_node_id` VARCHAR(40) DEFAULT NULL COMMENT '退回目标节点稳定ID；为空表示退回申请人，其他动作不用',
  `form_snapshot` LONGTEXT DEFAULT NULL COMMENT '每轮提交时的完整表单JSON快照；接口按查看人字段权限裁剪，不直接序列化',
  PRIMARY KEY (`id`),
  KEY `idx_decision_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批操作及字段变更历史；保留人员节点快照，不反向授予历史操作人当前处理权';

-- 流程定义及可编辑草稿；已发布模型存独立版本，不修改运行中实例的审批规则
CREATE TABLE `ops_flow_definition` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `name` varchar(100) NOT NULL COMMENT '流程名称；发起时复制为实例名称快照',
  `code` varchar(64) NOT NULL COMMENT '唯一流程编码；业务识别使用，区别于显示名',
  `description` varchar(500) DEFAULT NULL COMMENT '流程用途说明',
  `enabled` tinyint(1) NOT NULL COMMENT '是否允许新发起；停用不改变历史版本与已存在申请的快照',
  `category_id` bigint DEFAULT NULL COMMENT '审批分类 ID，逻辑关联 sys_entry.id 且 kind=approvalcategories',
  `business_type` varchar(24) NOT NULL DEFAULT 'GENERAL' COMMENT '业务类型：GENERAL 通用表单或 CONTENT 内容修订审核',
  `draft_schema` longtext COMMENT '当前可编辑模型 JSON；包含表单、节点、条件、范围和动作，经 WorkflowSchema 校验',
  `published_version_id` bigint DEFAULT NULL COMMENT '最近发布版本 ID，逻辑关联 ops_flow_version.id；NULL 时不可发起新申请',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='流程定义及可编辑草稿；已发布模型存独立版本，不修改运行中实例的审批规则';

-- 审批实例；冻结模型、原始表单和解析人员，当前任务与历史决定另表记录
CREATE TABLE `ops_flow_request` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `definition_id` bigint DEFAULT NULL COMMENT '来源流程定义 ID，逻辑关联 ops_flow_definition；历史保留名称及模型快照',
  `definition_name` varchar(100) DEFAULT NULL COMMENT '发起时流程名称快照',
  `title` varchar(160) NOT NULL COMMENT '申请标题；不是授权依据',
  `content` text NOT NULL COMMENT '申请说明正文，经富文本清理；详情按参与关系及字段权限返回',
  `applicant_id` bigint DEFAULT NULL COMMENT '发起账号 ID，逻辑关联 sys_user.id；决定本人申请范围',
  `applicant_name` varchar(64) DEFAULT NULL COMMENT '发起人昵称快照',
  `status` varchar(20) NOT NULL COMMENT '申请状态：DRAFT草稿/PENDING审批中/RETURNED待修改/APPROVED通过/REJECTED终止性驳回/WITHDRAWN撤回/CANCELLED管理员终止',
  `current_step` int NOT NULL COMMENT 'V3 顺序审批的步骤索引兼容字段；新版以 current_node_id 和待办任务为准',
  `current_approver_id` bigint DEFAULT NULL COMMENT '旧版单人当前审批人兼容字段；新版多任务处理必须查 ops_flow_task',
  `definition_version_id` bigint DEFAULT NULL COMMENT '绑定发布版本 ID，逻辑关联 ops_flow_version.id；旧实例导入时补齐',
  `schema_snapshot` longtext COMMENT '本实例冻结模型 JSON；后续流程发布不能改变其节点与字段规则',
  `form_data` longtext COMMENT '当前表单值 JSON；审批人仅能修改当前节点授权可写且可读的字段',
  `resolved_assignees` longtext COMMENT '实例解析的节点审批人快照 JSON；实际处理仍校验账号和当前审批权限',
  `current_node_id` varchar(40) DEFAULT NULL COMMENT '当前审批节点稳定 ID；与模型 node.id 对应，不是数据库自增 ID',
  `business_type` varchar(24) NOT NULL DEFAULT 'GENERAL' COMMENT 'GENERAL 通用申请或 CONTENT 内容审核；用于选择业务绑定处理器',
  `business_id` bigint DEFAULT NULL COMMENT '关联业务主记录 ID；CONTENT 时为 cms_notice.id，逻辑引用',
  `business_revision_id` bigint DEFAULT NULL COMMENT '关联业务修订 ID；CONTENT 时为 cms_revision.id，只授权这个版本',
  `completed_at` datetime(6) DEFAULT NULL COMMENT '结束时间；通过、驳回或撤回时写入，审批中为 NULL',
  `submitted_form_data` longtext COMMENT '发起时的原始表单 JSON，不随节点修改变化；字段读取仍须应用可见性过滤',
  `last_reminded_at` datetime(6) DEFAULT NULL COMMENT '申请人最近一次手动催办时间；每30分钟最多一次，不改变审批状态和节点授权',
  `run_number` INT NOT NULL DEFAULT 1 COMMENT '提交轮次：未提交草稿为0；首次提交为1；修改重提递增',
  `node_visit` INT NOT NULL DEFAULT 0 COMMENT '节点办理批次：每次进入审批或抄送递增，用于隔离退回后的旧决定',
  `active_path` TEXT DEFAULT NULL COMMENT '当前轮实际审批路径JSON，nodes为稳定节点ID数组；退回时裁剪，重提时清空',
  `submitted_at` DATETIME(6) DEFAULT NULL COMMENT '最近一次正式提交时间；未提交草稿为空，不使用草稿创建时间冒充',
  PRIMARY KEY (`id`),
  KEY `idx_request_applicant` (`applicant_id`),
  KEY `idx_request_approver` (`current_approver_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批实例；冻结模型、原始表单和解析人员，当前任务与历史决定另表记录';

-- V3 顺序流程审批人列表兼容表；新版流程从版本化 JSON 模型解析，保留旧流程导入依据
CREATE TABLE `ops_flow_step` (
  `definition_id` bigint NOT NULL COMMENT '流程定义 ID，外键 ops_flow_definition.id',
  `step_index` int NOT NULL COMMENT '旧版步骤索引，从 0 开始，表示列表顺序',
  `approver_id` bigint NOT NULL COMMENT '旧版指定审批人账号 ID，逻辑关联 sys_user.id',
  PRIMARY KEY (`definition_id`,`step_index`),
  CONSTRAINT `ops_flow_step_ibfk_1` FOREIGN KEY (`definition_id`) REFERENCES `ops_flow_definition` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='V3 顺序流程审批人列表兼容表；新版流程从版本化 JSON 模型解析，保留旧流程导入依据';

-- 实例节点对单个审批人的任务；处理时锁定实例并检查任务归属、动作权限和乐观版本
CREATE TABLE `ops_flow_task` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  `node_id` varchar(40) NOT NULL COMMENT '模型节点稳定 ID，与实例快照中节点对应',
  `node_name` varchar(80) NOT NULL COMMENT '生成任务时节点名称快照',
  `assignee_id` bigint NOT NULL COMMENT '待办账号 ID，逻辑关联 sys_user.id；不能由请求参数冒充',
  `assignee_name` varchar(64) NOT NULL COMMENT '待办人昵称快照',
  `status` varchar(20) NOT NULL COMMENT '任务状态：WAITING顺签未轮到/PENDING待办/APPROVED通过/REJECTED驳回/RETURNED退回/TRANSFERRED转交/CANCELLED失效/COPIED抄送',
  `mandatory` tinyint(1) NOT NULL DEFAULT '0' COMMENT '加签必签标记；1 时必须独立通过，不能被原或签审批人的通过代替',
  `decided_at` datetime(6) DEFAULT NULL COMMENT '任务已处理时间；尚未处理时为 NULL',
  `due_at` datetime(6) DEFAULT NULL COMMENT '审批任务到期时间，由已发布流程版本的节点超时分钟数计算；NULL表示未设置超时',
  `timeout_notified_at` datetime(6) DEFAULT NULL COMMENT '已发送本任务一次超时提醒的时间；NULL表示尚未提醒，任务行锁保证并发幂等',
  `run_number` INT NOT NULL DEFAULT 1 COMMENT '所属提交轮次，与申请重提轮次对应；旧任务只作为历史',
  `node_visit` INT NOT NULL DEFAULT 0 COMMENT '所属节点办理批次；同一节点退回重办不得混用以前的会签结果',
  `kind` VARCHAR(16) NOT NULL DEFAULT 'APPROVAL' COMMENT '任务种类：APPROVAL审批/COPY抄送，抄送不具备决定权限',
  `read_at` DATETIME(6) DEFAULT NULL COMMENT '抄送接收者首次已读时间，空表示未读；审批任务不用此字段',
  PRIMARY KEY (`id`),
  KEY `idx_task_pending` (`assignee_id`,`status`,`request_id`),
  KEY `idx_flow_task_round_visit` (`request_id`,`run_number`,`node_visit`),
  KEY `idx_flow_task_copy_reader` (`assignee_id`,`kind`,`read_at`),
  CONSTRAINT `ops_flow_task_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `ops_flow_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='实例节点对单个审批人的任务；处理时锁定实例并检查任务归属、动作权限和乐观版本';

-- 流程不可变发布版本；申请绑定具体版本并持有模型快照
CREATE TABLE `ops_flow_version` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `definition_id` bigint NOT NULL COMMENT '流程定义 ID，外键 ops_flow_definition.id',
  `version_number` int NOT NULL COMMENT '定义内递增发布版本号，与 definition_id 联合唯一；区别于 JPA version',
  `schema_json` longtext NOT NULL COMMENT '发布时完整且已校验的流程/表单 JSON；后续改草稿不能覆盖',
  `publisher_name` varchar(64) DEFAULT NULL COMMENT '发布操作人昵称快照',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_flow_version` (`definition_id`,`version_number`),
  CONSTRAINT `ops_flow_version_ibfk_1` FOREIGN KEY (`definition_id`) REFERENCES `ops_flow_definition` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='流程不可变发布版本；申请绑定具体版本并持有模型快照';

-- 受控任务调度配置；只执行固定内部处理器，不接受任意类名、脚本或系统命令
CREATE TABLE `ops_job` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `name` varchar(100) NOT NULL COMMENT '任务显示名称',
  `handler` varchar(64) NOT NULL COMMENT '固定处理器：SESSION_CLEANUP 清理过期会话或 DATABASE_CHECK 检查数据库',
  `cron` varchar(100) NOT NULL COMMENT 'Spring 六段 Cron，秒 分 时 日 月 周；应用在保存时校验并计算下一次执行',
  `description` varchar(500) DEFAULT NULL COMMENT '任务用途说明',
  `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  `next_run_at` datetime(6) DEFAULT NULL COMMENT '下一次计划执行北京时间；停用任务为 NULL，轮询通过行锁避免重复领取',
  `alert_user_id` bigint DEFAULT NULL COMMENT '任务失败提醒的账号ID；NULL表示不提醒，保存时验证有效账号及调度查看权限',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控任务调度配置；只执行固定内部处理器，不接受任意类名、脚本或系统命令';

-- 受控调度执行记录；只记录必要的运行结果，不返回用户数等超出调度授权的业务信息
CREATE TABLE `ops_job_execution` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `job_id` bigint DEFAULT NULL COMMENT '任务 ID，逻辑关联 ops_job.id；任务删除后历史可保留',
  `job_name` varchar(100) DEFAULT NULL COMMENT '执行时任务名称快照',
  `status` varchar(16) DEFAULT NULL COMMENT '执行结果状态：SUCCESS成功、FAILED失败；失败结果独立于业务事务保存，不能将请求成功等同于任务成功',
  `result` varchar(1000) DEFAULT NULL COMMENT '脱敏的运行结果说明；不得包含密码、令牌或未经授权的业务聚合数据',
  `duration_ms` bigint NOT NULL COMMENT '处理器耗时，单位毫秒',
  `failure_notified_at` datetime(6) DEFAULT NULL COMMENT '失败提醒已投递或无有效接收人跳过的时间；NULL为待重试，成功记录不参与提醒队列',
  PRIMARY KEY (`id`),
  KEY `idx_execution_job` (`job_id`),
  KEY idx_job_execution_failure (status,failure_notified_at,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控调度执行记录；只记录必要的运行结果，不返回用户数等超出调度授权的业务信息';

-- V3 旧站内信兼容表；V8 已迁移为通知和投递，当前消息接口不以本表为权威来源
CREATE TABLE `ops_message` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `title` varchar(160) NOT NULL COMMENT '旧消息标题；V8 逐条迁移为独立通知',
  `content` text NOT NULL COMMENT '旧消息纯文本正文；迁移时转义为安全 HTML',
  `sender_id` bigint DEFAULT NULL COMMENT '旧发送者账号 ID，逻辑关联 sys_user.id',
  `sender_name` varchar(64) DEFAULT NULL COMMENT '旧发送者昵称快照',
  `recipient_id` bigint NOT NULL COMMENT '旧接收者账号 ID，逻辑关联 sys_user.id',
  `read_at` datetime(6) DEFAULT NULL COMMENT '旧阅读时间；迁移保留到 ops_delivery.read_at',
  PRIMARY KEY (`id`),
  KEY `idx_message_recipient` (`recipient_id`,`read_at`),
  KEY `idx_message_sender` (`sender_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='V3 旧站内信兼容表；V8 已迁移为通知和投递，当前消息接口不以本表为权威来源';

-- 通知发布批次；正文、接收目标及每位收件人的阅读状态分别存储，发布后冻结接收者
CREATE TABLE `ops_notification` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `title` varchar(160) NOT NULL COMMENT '通知标题，最长 160 字',
  `summary` varchar(500) DEFAULT NULL COMMENT '通知摘要；列表使用，避免列表返回完整富文本正文',
  `content` longtext NOT NULL COMMENT '通知正文HTML或清洗后纯文本；最多50000字符，使用LONGTEXT兼容中文多字节，已发布正文不可原地修改',
  `type` varchar(24) NOT NULL COMMENT '通知类别：NOTICE 通知、ANNOUNCEMENT 公告、REMINDER 提醒；由服务端白名单验证',
  `status` varchar(24) NOT NULL COMMENT '状态：DRAFT 草稿、PUBLISHED 已发布、WITHDRAWN 已撤回；过期还须检查 expires_at',
  `recipient_type` varchar(24) NOT NULL COMMENT '接收范围：USERS 指定账号、DEPARTMENTS 部门、ROLES 角色、ALL 全部；发布时展开并冻结',
  `sender_id` bigint DEFAULT NULL COMMENT '创建者账号 ID，逻辑关联 sys_user.id；没有 notifications:all 时仅可管理本人通知',
  `sender_name` varchar(64) DEFAULT NULL COMMENT '发送者显示名快照；系统事件可使用系统名称',
  `published_at` datetime(6) DEFAULT NULL COMMENT '本批次发布时间；草稿为 NULL，发布后填写北京时间',
  `expires_at` datetime(6) DEFAULT NULL COMMENT '到期时间；NULL 不设到期，超过时间收件人不能继续读取正文/附件',
  `withdrawn_at` datetime(6) DEFAULT NULL COMMENT '撤回时间；撤回后收件人正文与附件访问一并失效',
  `target_type` varchar(24) DEFAULT NULL COMMENT '可选业务跳转类型，例如审批申请；必须由客户端已登记目标处理',
  `target_id` bigint DEFAULT NULL COMMENT '业务跳转目标 ID，逻辑引用；跳转后的业务接口仍需独立鉴权',
  `event_key` varchar(160) DEFAULT NULL COMMENT '可选业务事件唯一键；防止可靠事件重试重复创建通知，普通人工通知可为 NULL',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_key` (`event_key`),
  KEY `idx_notification_owner` (`sender_id`,`status`),
  KEY `idx_notification_expiry` (`status`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知发布批次；正文、接收目标及每位收件人的阅读状态分别存储，发布后冻结接收者';

-- 通知附件关联；关联前检查上传者资格，收件下载复核投递归属、撤回和到期状态
CREATE TABLE `ops_notification_file` (
  `notification_id` bigint NOT NULL COMMENT '通知 ID，外键 ops_notification.id，随通知删除级联清理',
  `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；引用中禁止文件中心删除',
  PRIMARY KEY (`notification_id`,`file_id`),
  KEY `file_id` (`file_id`),
  CONSTRAINT `ops_notification_file_ibfk_1` FOREIGN KEY (`notification_id`) REFERENCES `ops_notification` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ops_notification_file_ibfk_2` FOREIGN KEY (`file_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知附件关联；关联前检查上传者资格，收件下载复核投递归属、撤回和到期状态';

-- 通知草稿的目标集合；target_id 的实体种类由通知 recipient_type 决定，不能跨种类解释
CREATE TABLE `ops_notification_target` (
  `notification_id` bigint NOT NULL COMMENT '所属通知 ID，外键 ops_notification.id，随通知删除级联清理',
  `target_id` bigint NOT NULL COMMENT '账号/部门/角色 ID，按 recipient_type 逻辑关联；ALL 不使用目标集合，发布时重新校验权限',
  PRIMARY KEY (`notification_id`,`target_id`),
  CONSTRAINT `ops_notification_target_ibfk_1` FOREIGN KEY (`notification_id`) REFERENCES `ops_notification` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知草稿的目标集合；target_id 的实体种类由通知 recipient_type 决定，不能跨种类解释';

-- 审批实例附件关联；下载同时校验实际参与资格、实例可读字段和附件归属
CREATE TABLE `ops_request_file` (
  `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；引用期间禁止文件中心删除',
  PRIMARY KEY (`request_id`,`file_id`),
  KEY `file_id` (`file_id`),
  CONSTRAINT `ops_request_file_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `ops_flow_request` (`id`),
  CONSTRAINT `ops_request_file_ibfk_2` FOREIGN KEY (`file_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审批实例附件关联；下载同时校验实际参与资格、实例可读字段和附件归属';

-- V3 实例的顺序审批人快照兼容表；新版任务来源为实例模型及 ops_flow_task
CREATE TABLE `ops_request_step` (
  `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  `step_index` int NOT NULL COMMENT '旧版实例步骤索引，从 0 开始',
  `approver_id` bigint NOT NULL COMMENT '旧版快照审批人账号 ID，逻辑关联 sys_user.id',
  PRIMARY KEY (`request_id`,`step_index`),
  CONSTRAINT `ops_request_step_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `ops_flow_request` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='V3 实例的顺序审批人快照兼容表；新版任务来源为实例模型及 ops_flow_task';

-- 操作和登录审计；写入及导出记录结果，不记录正文、查询参数、密码或原令牌
CREATE TABLE `sys_audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `username` varchar(64) DEFAULT NULL COMMENT '认证账号或 anonymous；登录失败时是请求者声称的用户名，不代表该账号已认证操作',
  `method` varchar(12) DEFAULT NULL COMMENT 'HTTP 请求方法，例如 GET/POST/PUT/DELETE',
  `path` varchar(255) DEFAULT NULL COMMENT '请求路径，最多 255 字，不含查询参数；/api/auth/login 用于区分登录日志',
  `status` int NOT NULL COMMENT 'HTTP 响应状态码；成功与失败均记录，登录失败不可计入活跃用户',
  `duration_ms` bigint NOT NULL COMMENT '请求处理耗时，单位毫秒；不含后续日志持久化时间',
  `ip` varchar(64) DEFAULT NULL COMMENT '请求来源地址；默认连接对端地址，不能信任任意客户端转发头',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作和登录审计；写入及导出记录结果，不记录正文、查询参数、密码或原令牌';

-- 字典类型下的选项；类型停用或选项停用后不再返回给业务选择器
CREATE TABLE `sys_dictionary_item` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `dictionary_id` bigint NOT NULL COMMENT '字典类型 ID，外键 sys_entry.id 且 kind=dictionaries',
  `label` varchar(100) NOT NULL COMMENT '面向用户的选项名称；可以修改名称而保留稳定 value',
  `value` varchar(100) NOT NULL COMMENT '同一字典内唯一的实际业务值；与显示名称分离',
  `color` varchar(20) DEFAULT NULL COMMENT '可选标签颜色标识；仅用于展示，输入由字典接口约束',
  `sort_order` int NOT NULL COMMENT '显示排序值；升序，同值再按主键排序',
  `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dictionary_value` (`dictionary_id`,`value`),
  CONSTRAINT `fk_dictionary_type` FOREIGN KEY (`dictionary_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='字典类型下的选项；类型停用或选项停用后不再返回给业务选择器';

-- 共用基础资料；kind 隔离部门、菜单、岗位、字典、参数、内容分类标签和审批分类
CREATE TABLE `sys_entry` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `kind` varchar(32) NOT NULL COMMENT '资源类型：departments/menus/posts/dictionaries/settings/categories/tags/approvalcategories；接口逐类鉴权',
  `name` varchar(100) NOT NULL COMMENT '业务显示名称；分类及标签由应用进一步限制为 32 字',
  `code` varchar(100) NOT NULL COMMENT '同 kind 内唯一编码；settings 时为参数键，menus 时为已实现页面编码',
  `value` varchar(2000) DEFAULT NULL COMMENT '通用配置值，最长 2000 字；settings 按 value_type 校验，字典旧汇总值仅作兼容，禁止存凭据',
  `description` varchar(500) DEFAULT NULL COMMENT '业务用途或参数含义说明；不作为可执行表达式使用',
  `permission` varchar(100) DEFAULT NULL COMMENT '菜单访问所需权限标识；必须匹配 NavigationCatalog 中的路径登记，非菜单通常为空',
  `path` varchar(160) DEFAULT NULL COMMENT '菜单前端路由；只接受已实现的后台页面，不作为任意 URL 跳转入口',
  `parent_id` bigint DEFAULT NULL COMMENT '父基础资料 ID，外键 sys_entry.id 且业务要求同 kind；部门父链检查循环，当前菜单保持平铺分组',
  `sort_order` int NOT NULL COMMENT '显示排序值；升序，同值再按主键排序',
  `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  `leader_id` bigint DEFAULT NULL COMMENT '部门负责人账号 ID，外键 sys_user.id；仅 departments 使用，账号删除前需解除负责人关系',
  `icon` varchar(64) DEFAULT NULL COMMENT '已登记的菜单图标编码；不是 HTML/SVG 源代码',
  `group_name` varchar(64) NOT NULL DEFAULT '通用' COMMENT '系统参数展示分组；默认通用，仅为分类信息，不授予任何权限',
  `value_type` varchar(16) NOT NULL DEFAULT 'TEXT' COMMENT '参数类型：TEXT/NUMBER/BOOLEAN/EMAIL/JSON；决定 value 的校验方式，不接受任意类型名',
  `built_in` tinyint(1) NOT NULL DEFAULT '0' COMMENT '内置参数标记：1 时禁止删除和改编码；不是超级管理员标记',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_entry_kind_code` (`kind`,`code`),
  KEY `idx_entry_parent` (`parent_id`),
  KEY `fk_department_leader` (`leader_id`),
  CONSTRAINT `fk_department_leader` FOREIGN KEY (`leader_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_entry_parent` FOREIGN KEY (`parent_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='共用基础资料；kind 隔离部门、菜单、岗位、字典、参数、内容分类标签和审批分类';

-- 授权角色；操作权限和各资源数据范围分别保存，多启用角色按可访问记录取并集
CREATE TABLE `sys_role` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `code` varchar(64) NOT NULL COMMENT '唯一角色编码；admin 为受保护的超级管理员角色，普通角色不能授予超出自身权限的能力',
  `name` varchar(64) NOT NULL COMMENT '角色展示名称；不用于鉴权判断',
  `description` varchar(500) DEFAULT NULL COMMENT '角色职责与授权用途说明',
  `enabled` tinyint(1) NOT NULL COMMENT '角色启用标记；0 时此角色的操作权限和数据范围不参与有效授权',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='授权角色；操作权限和各资源数据范围分别保存，多启用角色按可访问记录取并集';

-- 角色的资源操作权限；独立于导航菜单，标识必须登记在 PermissionCatalog
CREATE TABLE `sys_role_permission` (
  `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  `permission` varchar(100) NOT NULL COMMENT '资源:操作，例如 users:view、users:email-read；不支持任意通配符，未知标识拒绝保存',
  PRIMARY KEY (`role_id`,`permission`),
  CONSTRAINT `fk_permission_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色的资源操作权限；独立于导航菜单，标识必须登记在 PermissionCatalog';

-- 角色按资源配置的数据范围；只有同时拥有该资源 view 权限的角色参与范围合并
CREATE TABLE `sys_role_scope` (
  `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  `resource` varchar(64) NOT NULL COMMENT '支持数据范围的资源键，来自 PermissionCatalog 的 scoped 目录',
  `data_scope` varchar(32) DEFAULT NULL COMMENT 'SELF 本人、DEPARTMENT 本部门、DEPARTMENT_TREE 部门及下级、CUSTOM 指定部门、ALL 全部；应用缺省 SELF，未知值不扩权',
  PRIMARY KEY (`role_id`,`resource`),
  CONSTRAINT `fk_scope_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色按资源配置的数据范围；只有同时拥有该资源 view 权限的角色参与范围合并';

-- CUSTOM 范围的明确部门集合；按角色和资源独立授权，不自动包含下级部门或本人
CREATE TABLE `sys_role_scope_department` (
  `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  `resource` varchar(64) NOT NULL COMMENT '数据范围所属资源键，必须在同角色对应资源上选择 CUSTOM',
  `department_id` bigint NOT NULL COMMENT '授权部门 ID，外键 sys_entry.id；业务要求有效部门，引用中的部门不可删除',
  PRIMARY KEY (`role_id`,`resource`,`department_id`),
  KEY `fk_scope_department_entry` (`department_id`),
  CONSTRAINT `fk_scope_department_entry` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`),
  CONSTRAINT `fk_scope_department_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='CUSTOM 范围的明确部门集合；按角色和资源独立授权，不自动包含下级部门或本人';

-- 可撤销的服务端登录会话；只存随机 Bearer 令牌的 SHA-256 摘要，不存原令牌
CREATE TABLE `sys_session` (
  `token_hash` varchar(64) NOT NULL COMMENT '令牌 SHA-256 小写十六进制摘要，64 字符主键；不通过会话列表公开',
  `user_id` bigint NOT NULL COMMENT '会话账号 ID，外键 sys_user.id；鉴权时重新加载账号状态和角色',
  `expires_at` timestamp(6) NOT NULL COMMENT '绝对过期时刻，TIMESTAMP 存储时间点；签发后 12 小时，不因活跃时间更新而延长',
  `session_id` varchar(36) DEFAULT NULL COMMENT '随机 UUID 公开会话标识，唯一；用于列表及撤销接口，不能作为登录令牌使用',
  `created_at` timestamp(6) NULL DEFAULT NULL COMMENT '会话签发时刻，TIMESTAMP 时间点；V3 前历史会话迁移时回填',
  `last_active_at` timestamp(6) NULL DEFAULT NULL COMMENT '最近活跃时刻，TIMESTAMP；为减少写入至多约每分钟更新一次',
  `ip` varchar(64) DEFAULT NULL COMMENT '登录请求来源地址；默认取连接对端，可信代理部署需要另行配置',
  `device` varchar(255) DEFAULT NULL COMMENT '登录请求 User-Agent 截断至 255 字符；客户端声明信息，不能用于鉴权',
  PRIMARY KEY (`token_hash`),
  UNIQUE KEY `uk_session_public_id` (`session_id`),
  KEY `idx_session_expiry` (`expires_at`),
  KEY `fk_session_user` (`user_id`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可撤销的服务端登录会话；只存随机 Bearer 令牌的 SHA-256 摘要，不存原令牌';

-- 系统账号；密码只存 BCrypt 摘要，组织及角色关联参与每次请求鉴权
CREATE TABLE `sys_user` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  `username` varchar(64) NOT NULL COMMENT '唯一登录名；修改个人资料不能改变此值，内置 admin 账号受保护',
  `password_hash` varchar(100) NOT NULL COMMENT 'BCrypt 密码摘要，cost=12；禁止保存或返回明文密码',
  `nickname` varchar(64) NOT NULL COMMENT '显示昵称；不是登录凭据，审计身份以认证账号为准',
  `email` varchar(128) DEFAULT NULL COMMENT '联系邮箱；用户管理按 users:email-read/write 或 sensitive 权限读写，个人资料允许本人维护',
  `phone` varchar(32) DEFAULT NULL COMMENT '联系电话；用户管理按 users:phone-read/write 或 sensitive 权限读写，个人资料允许本人维护',
  `department_id` bigint DEFAULT NULL COMMENT '所属部门 ID，物理外键 sys_entry.id 且业务要求 kind=departments；NULL 表示未分配部门',
  `enabled` tinyint(1) NOT NULL COMMENT '账号启用标记：0 禁止登录且已有会话不能继续访问；停用同时撤销该账号会话',
  `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_user_department` (`department_id`),
  CONSTRAINT `fk_user_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统账号；密码只存 BCrypt 摘要，组织及角色关联参与每次请求鉴权';

-- 账号与岗位多对多关联；岗位表示任职信息，本表不直接授予操作权限
CREATE TABLE `sys_user_post` (
  `user_id` bigint NOT NULL COMMENT '账号 ID，外键 sys_user.id',
  `post_id` bigint NOT NULL COMMENT '岗位 ID，外键 sys_entry.id 且业务要求 kind=posts',
  PRIMARY KEY (`user_id`,`post_id`),
  KEY `post_id` (`post_id`),
  CONSTRAINT `sys_user_post_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `sys_user_post_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号与岗位多对多关联；岗位表示任职信息，本表不直接授予操作权限';

-- 账号与角色多对多关联；联合主键防止重复授权，用户与角色均有物理外键
CREATE TABLE `sys_user_role` (
  `user_id` bigint NOT NULL COMMENT '账号 ID，外键 sys_user.id',
  `role_id` bigint NOT NULL COMMENT '角色 ID，外键 sys_role.id；仅启用角色参与授权',
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `fk_user_role_role` (`role_id`),
  CONSTRAINT `fk_user_role_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`),
  CONSTRAINT `fk_user_role_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号与角色多对多关联；联合主键防止重复授权，用户与角色均有物理外键';


-- Flyway 版本管理表：记录本文件对应的 V15 基线，后续仍按正常增量迁移升级。
-- BASELINE 声明当前结构已处于版本 20；不伪造历史迁移的执行校验和。
-- 参考：https://documentation.red-gate.com/flyway/flyway-concepts/baselines
CREATE TABLE flyway_schema_history (
  installed_rank INT NOT NULL COMMENT '安装记录顺序；由 Flyway 后续维护',
  version VARCHAR(50) DEFAULT NULL COMMENT '数据库迁移版本；本初始化基线为 20',
  description VARCHAR(200) NOT NULL COMMENT '迁移描述或基线标记',
  type VARCHAR(20) NOT NULL COMMENT '记录类型；BASELINE 表示导入后的结构起点，后续 SQL 表示增量迁移',
  script VARCHAR(1000) NOT NULL COMMENT '迁移脚本名或标准基线标记',
  checksum INT DEFAULT NULL COMMENT '迁移校验和；BASELINE 不执行历史脚本，因此为 NULL',
  installed_by VARCHAR(100) NOT NULL COMMENT '执行安装的数据库账号',
  installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本次安装时间点',
  execution_time INT NOT NULL COMMENT '执行耗时毫秒；静态基线记录为 0',
  success TINYINT(1) NOT NULL COMMENT '执行成功标记；1 表示成功，禁止人工改写失败记录',
  PRIMARY KEY (installed_rank),
  KEY flyway_schema_history_s_idx (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Flyway 迁移历史；由框架维护，禁止手动删除或修改已执行记录';

-- 工单管理独立模块；创建者与部门在服务端确定，所有读写遵守动作权限和行级范围。
CREATE TABLE `biz_work_order` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增，不接受客户端指定',
  `title` varchar(160) NOT NULL COMMENT '标题；最大 160 个字符',
  `description` varchar(1000) DEFAULT NULL COMMENT '说明；最大 1000 个字符',
  `enabled` tinyint(1) NOT NULL COMMENT '启用状态；1 启用，0 停用',
  `owner_id` bigint NOT NULL COMMENT '创建账号主键；服务器从有效登录身份赋值，普通编辑不可修改',
  `department_id` bigint DEFAULT NULL COMMENT '创建时部门主键；用于部门及指定部门数据范围判断',
  `created_at` datetime(6) NOT NULL COMMENT '创建时间；服务端生成，Asia/Shanghai',
  `updated_at` datetime(6) NOT NULL COMMENT '最近修改时间；服务端在事务提交时维护',
  `version` bigint NOT NULL DEFAULT '0' COMMENT '乐观锁版本；编辑和删除必须提交当前值，否则返回 409',
  PRIMARY KEY (`id`),
  KEY `idx_biz_work_order_owner` (`owner_id`),
  KEY `idx_biz_work_order_department` (`department_id`),
  CONSTRAINT `fk_biz_work_order_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`),
  CONSTRAINT `fk_biz_work_order_department` FOREIGN KEY (`department_id`) REFERENCES `sys_entry` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='工单管理业务记录；模块关闭时保留数据';

SET SESSION foreign_key_checks = @mayday_original_foreign_key_checks;

-- 必要基础资料，与逐版迁移空库时的结果一致；不带入任何现有环境的业务配置。
-- 菜单只声明页面及所需权限，不会为普通角色自动授权；未列出的菜单由应用补齐。
-- 通用审批/内容审核是初始可编辑分类，content.requireApproval 默认 false。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',page.name,page.code,page.path,page.permission,page.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '岗位管理' name,'posts' code,'/admin/posts' path,'posts:view' permission,10 sort_order
 UNION ALL SELECT '登录日志','loginlogs','/admin/login-logs','loginlogs:view',11
 UNION ALL SELECT '用户统计','userstats','/admin/user-statistics','userstats:view',12
 UNION ALL SELECT '网站配置','site','/admin/site-settings','settings:view',13
) page WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=page.code OR e.path=page.path));

INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '通知管理' name,'notifications' code,'/admin/notifications' path,'notifications:view' permission,20 sort_order
 UNION ALL SELECT '个人收件箱','messages','/admin/messages','messages:view',21
 UNION ALL SELECT '文件中心','files','/admin/files','files:view',22
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=p.code OR e.path=p.path));

INSERT INTO sys_entry(kind,name,code,value,value_type,group_name,built_in,sort_order,enabled,created_at,updated_at,version)
SELECT 'settings','内容必须审核','content.requireApproval','false','BOOLEAN','内容',TRUE,0,TRUE,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='settings' AND code='content.requireApproval');

INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '内容分类' name,'categories' code,'/admin/categories' path,'categories:view' permission,30 sort_order
 UNION ALL SELECT '内容标签','tags','/admin/tags','tags:view',31
 UNION ALL SELECT '内容回收站','recycle','/admin/recycle','notices:view',32
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=p.code OR e.path=p.path));

INSERT INTO sys_entry(kind,name,code,sort_order,enabled,created_at,updated_at,version)
 VALUES('approvalcategories','通用审批','general',0,TRUE,NOW(6),NOW(6),0),
 ('approvalcategories','内容审核','content',1,TRUE,NOW(6),NOW(6),0);

INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0
FROM (
 SELECT '审批分类' name,'approvalcategories' code,'/admin/approval-categories' path,'approvalcategories:view' permission,80 sort_order
 UNION ALL SELECT '流程定义','workflows','/admin/workflows','workflows:view',81
 UNION ALL SELECT '审批申请','requests','/admin/requests','requests:view',82
 UNION ALL SELECT '审批待办','tasks','/admin/tasks','requests:approve',83
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND e.path=p.path);

-- 图片采集独立模块。队列、来源与失败记录可恢复；文件复用 ops_file/ops_file_payload。
-- 不修改原有账号、角色授权或内容。仅超级管理员自动拥有目录中新注册的权限。
CREATE TABLE `crawl_task` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '采集任务主键；数据库自增，无业务含义',
  `created_at` datetime(6) NOT NULL COMMENT '任务创建时间；应用填充，北京时间，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '最近一次规则、状态或进度变更时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；编辑与开始、停止、重试请求携带并校验',
  `name` varchar(100) NOT NULL COMMENT '用户填写的任务名称，不作为文件路径或命令执行',
  `owner_id` bigint NOT NULL COMMENT '创建者账号 ID；逻辑关联 sys_user，决定任务默认可见范围和文件归属',
  `owner_name` varchar(64) NOT NULL COMMENT '创建者显示名快照；保留任务历史，不随改名更新',
  `runner_id` bigint DEFAULT NULL COMMENT '本轮启动账号 ID；每次领取及结果入库重新校验其当前权限',
  `status` varchar(20) NOT NULL COMMENT 'DRAFT 草稿、QUEUED 排队、RUNNING 执行、PAUSED 停止、COMPLETED 完成、PARTIAL 部分失败、LIMITED 达上限',
  `archived` bit(1) NOT NULL DEFAULT b'0' COMMENT '配置是否已删除归档；是则隐藏配置并禁止编辑和执行，保留已有图文及原所有者授权，否为正常配置',
  `rules_json` text NOT NULL COMMENT '已校验的采集规则 JSON；列表与详情各自分页，开始后规则不可原地修改',
  `lease_token` varchar(36) DEFAULT NULL COMMENT '当前执行租约随机标识；停止或新领取后旧令牌不能提交结果，不返回客户端',
  `lease_until` datetime(6) DEFAULT NULL COMMENT '租约截止时间；过期后允许其他工作器恢复 FETCHING 项',
  `next_fetch_at` datetime(6) DEFAULT NULL COMMENT '最早下次请求时间；实现每任务限速与失败退避',
  `last_error` varchar(300) DEFAULT NULL COMMENT '可向用户展示的最近错误或停止原因；不保存堆栈、认证信息和远端正文',
  `page_count` int NOT NULL COMMENT '成功解析的列表和详情页面总数，不含图片请求',
  `image_count` int NOT NULL COMMENT '成功保存的不同图片数量；同任务内容摘要去重后累计',
  `failed_count` int NOT NULL COMMENT '已达到三次尝试仍失败的队列项数量；显式重试时清零',
  `total_bytes` bigint NOT NULL COMMENT '本任务成功保存图片的累计字节数；上限 200 MB，不重复统计去重图片',
  PRIMARY KEY (`id`),
  KEY `idx_crawl_owner_status` (`owner_id`,`status`),
  KEY `idx_crawl_ready` (`status`,`next_fetch_at`,`lease_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='图片采集任务与双层分页规则、归属、执行租约及进度';

CREATE TABLE `crawl_article` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '采集文章主键；由数据库自增，仅用于本系统结果关联',
  `created_at` datetime(6) NOT NULL COMMENT '首次成功解析文章页面的入库时间；北京时间，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '最近一次文章标题、摘要或来源信息更新时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；文章写入同时持有所属任务行锁',
  `task_id` bigint NOT NULL COMMENT '所属采集任务；读取文章前必须校验任务权限和所有者',
  `source_url` varchar(2000) NOT NULL COMMENT '文章分页组首页的规范化公开地址；后续详情分页归入同一文章',
  `source_hash` varchar(64) NOT NULL COMMENT '来源首页 URL 的 SHA-256；与任务 ID 组成唯一键，防止重试生成重复文章',
  `title` varchar(200) NOT NULL COMMENT '文章标题纯文本；优先配置字段，再读取 h1、OG 标题或网页标题',
  `summary` varchar(300) NOT NULL COMMENT '正文开头的纯文本摘要；压缩空白后最多 300 字符，无正文时为空字符串',
  `author` varchar(100) NOT NULL COMMENT '来源作者原始文本；不映射本系统账号，无法识别时为空字符串',
  `published_at` varchar(100) NOT NULL COMMENT '来源发表时间文本；保留原格式而不推测时区，无法识别时为空字符串',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_article_source` (`task_id`,`source_hash`),
  CONSTRAINT `fk_crawl_article_task` FOREIGN KEY (`task_id`) REFERENCES `crawl_task` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采集文章标题、摘要和来源元数据；同篇分页只生成一张文章卡片';

CREATE TABLE `crawl_item` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '队列项主键；同一任务按 ID 顺序领取',
  `created_at` datetime(6) NOT NULL COMMENT '发现该地址并入队的时间；北京时间，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '最近一次领取、重试或结果变化时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；队列更改同时持有任务行锁',
  `task_id` bigint NOT NULL COMMENT '所属采集任务 ID；外键 crawl_task.id，接口必须核对归属',
  `kind` varchar(12) NOT NULL COMMENT 'LIST 列表页、DETAIL 详情及详情续页、IMAGE 图片',
  `status` varchar(20) NOT NULL COMMENT 'QUEUED 排队、FETCHING 请求中、SUCCESS 成功、FAILED 失败、DUPLICATE 内容重复、SKIPPED 达上限跳过',
  `url` varchar(2000) NOT NULL COMMENT '去掉片段并规范化的公开 HTTP/HTTPS 地址；实际访问前再次校验域名及 DNS',
  `url_hash` varchar(64) NOT NULL COMMENT '规范化地址的 SHA-256 十六进制摘要；同任务同类型唯一，防止分页循环',
  `root_url` varchar(2000) NOT NULL COMMENT '分页组首页地址；每篇详情拥有独立组，用于模板展开和页数上限',
  `source_url` varchar(2000) DEFAULT NULL COMMENT '发现该链接的来源页地址；入口页为空，图片可追溯来源',
  `title` varchar(200) DEFAULT NULL COMMENT '已解析 HTML 的网页标题摘要；纯文本展示，不执行网页 HTML',
  `ordinal` int NOT NULL COMMENT '分页组内从零开始的遍历深度；模板页码等于起始值加此值乘步长',
  `attempts` int NOT NULL COMMENT '本轮请求尝试次数；自动最多三次，手动重试失败项时归零',
  `file_id` bigint DEFAULT NULL COMMENT '采集文件 ID；外键 ops_file.id，引用存在时文件中心禁止删除',
  `digest` varchar(64) DEFAULT NULL COMMENT '成功下载图片内容的 SHA-256 摘要；只在同任务内去重，避免跨账号信息暴露',
  `bytes` bigint NOT NULL COMMENT '成功保存或引用图片的字节数；旧版重复记录、网页及失败项可能为零',
  `error` varchar(300) DEFAULT NULL COMMENT '该项最近一次请求或解析错误；不包含内部堆栈或网页正文',
  `article_id` bigint DEFAULT NULL COMMENT '成功页面所属采集文章 ID；图片通过独立关联表关联文章，旧记录为空',
  `article_body` mediumtext DEFAULT NULL COMMENT '当前分页的正文纯文本；移除脚本、表单和导航，每页最多 20000 字符，不保存远端可执行 HTML',
  `body_truncated` bit(1) NOT NULL DEFAULT b'0' COMMENT '正文是否超出单页上限而被截断；详情必须向用户提示，旧记录默认否',
  KEY `idx_crawl_item_article` (`article_id`,`ordinal`,`id`),
  CONSTRAINT `fk_crawl_item_article` FOREIGN KEY (`article_id`) REFERENCES `crawl_article` (`id`),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_url` (`task_id`,`kind`,`url_hash`),
  KEY `idx_crawl_queue` (`task_id`,`status`,`id`),
  KEY `idx_crawl_digest` (`task_id`,`digest`,`status`),
  CONSTRAINT `fk_crawl_task` FOREIGN KEY (`task_id`) REFERENCES `crawl_task` (`id`),
  CONSTRAINT `fk_crawl_file` FOREIGN KEY (`file_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='持久采集队列、网页来源、图片结果及失败重试记录';

CREATE TABLE `crawl_article_image` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '文章图片关联主键；不保存图片二进制',
  `created_at` datetime(6) NOT NULL COMMENT '首次在文章页面发现此图片引用的时间',
  `updated_at` datetime(6) NOT NULL COMMENT '关联记录最近变更时间；北京时间，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；关联更改同时持有任务行锁',
  `article_id` bigint NOT NULL COMMENT '所属采集文章 ID；同一图片可以被多篇文章分别引用',
  `item_id` bigint NOT NULL COMMENT '对应 IMAGE 队列项 ID；下载完成后通过其 file_id 读取文件，失败时保留关联供重试',
  `sort_order` int NOT NULL COMMENT '配图顺序：来源页遍历序号乘 1000 加页面内发现序号；封面取最早成功的不同图片',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_article_image` (`article_id`,`item_id`),
  KEY `idx_crawl_article_image_order` (`article_id`,`sort_order`,`id`),
  CONSTRAINT `fk_crawl_image_article` FOREIGN KEY (`article_id`) REFERENCES `crawl_article` (`id`),
  CONSTRAINT `fk_crawl_image_item` FOREIGN KEY (`item_id`) REFERENCES `crawl_item` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采集文章与图片队列的多对多引用；图片地址及内容去重不丢失文章配图关系';

INSERT INTO sys_entry(kind,name,code,value,description,permission,path,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','采集数据','crawler','','','crawler:view','/admin/crawler',75,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='crawler');

-- 数据与配置独立菜单；沿用查看权限和启用状态，不自动授予普通角色额外操作权限。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','采集配置','crawlerconfig','/admin/crawler-config','crawler:view',m.sort_order+1,m.enabled,NOW(6),NOW(6),0
FROM sys_entry m WHERE m.kind='menus' AND m.code='crawler'
AND NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND (code='crawlerconfig' OR path='/admin/crawler-config'));

-- 单路 UDP 转发持久配置。只保存配置，不保存逐包计数，不自动启动监听，不向普通角色授予权限。
CREATE TABLE `udp_relay_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '固定配置记录主键；当前单路使用 1，不按客户端指定 ID 创建监听',
  `bind_ip` varchar(64) NOT NULL COMMENT '接收绑定 IP；必须为转发服务器本地网卡地址或同地址族通配地址，不是浏览器所在电脑 IP',
  `bind_port` int NOT NULL COMMENT 'UDP 接收端口；允许 1024 至 65535，容器部署须另外映射此 UDP 端口',
  `target_ip` varchar(64) NOT NULL COMMENT '唯一转发目标的单播 IP；不使用域名、组播、广播或通配地址，禁止指向本机相同接收端口',
  `target_port` int NOT NULL COMMENT '唯一转发目标 UDP 端口；允许 1 至 65535，对端必须另行监听并核对接收情况',
  `receive_buffer_mib` int NOT NULL COMMENT '申请内核接收缓冲大小，单位 MiB，范围 1 至 64；实际大小受操作系统上限约束',
  `send_buffer_mib` int NOT NULL COMMENT '申请内核发送缓冲大小，单位 MiB，范围 1 至 64；页面展示实际授予值',
  `pending_memory_mib` int NOT NULL COMMENT '应用待发送缓冲内存上限，单位 MiB，范围 1 至 256；按缓冲容量及额外开销计量，超限计数丢弃',
  `created_at` datetime(6) NOT NULL COMMENT '配置创建时间，服务器 Asia/Shanghai 时区；非数据包到达时间',
  `updated_at` datetime(6) NOT NULL COMMENT '最近配置保存时间；实时统计和启停不触发逐包数据库更新',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；保存和启动需提交当前版本，防止旧页面覆盖或启动过期配置',
  `send_ip` varchar(64) NOT NULL DEFAULT '' COMMENT '发送本地源 IP；空字符串由系统路由选择，非空必须属于本机启用的网卡；不替代系统路由和 SO_BINDTODEVICE',
  `send_port` int NOT NULL DEFAULT 0 COMMENT '发送本地 UDP 源端口；0 为系统分配，或指定 1024 至 65535；独立于接收端口，不自动处理回包',
  `transport_mode` varchar(10) NOT NULL DEFAULT 'AUTO' COMMENT 'Netty UDP 传输模式：AUTO 优先 Linux EPOLL 否则 NIO；可固定 NIO 或 EPOLL 用于平台兼容验证，不可用的强制模式拒绝启动',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='独立 Netty UDP 转发的管理端配置；运行状态和计数仅保留于当前进程，重启默认停止';

INSERT INTO udp_relay_config(id,bind_ip,bind_port,target_ip,target_port,receive_buffer_mib,send_buffer_mib,pending_memory_mib,created_at,updated_at,version)
VALUES(1,'0.0.0.0',19000,'127.0.0.1',19001,16,16,64,NOW(6),NOW(6),0);

INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','UDP 转发','relay','/admin/udp-relay','relay:view',110,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='relay');

-- 只补建导航，不自动授予普通角色权限，不修改已有菜单或业务记录。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','工单管理','workorders','/admin/workorders','workorders:view',200,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='workorders');

CREATE TABLE `ops_file_directory` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '文件目录主键，由数据库生成；不是文件路径',
  `created_at` datetime(6) NOT NULL COMMENT '目录创建时间，由服务器生成，Asia/Shanghai时区',
  `updated_at` datetime(6) NOT NULL COMMENT '目录最后编辑时间，由服务器生成',
  `version` bigint DEFAULT NULL COMMENT 'JPA乐观锁版本，编辑或删除携带当前版本防止并发覆盖',
  `name` varchar(100) NOT NULL COMMENT '目录展示名称；同一所有者及父目录下唯一，不参与本地文件路径拼接',
  `parent_id` bigint NOT NULL DEFAULT 0 COMMENT '父目录ID；0表示根目录，服务端验证同一所有者和无循环关系',
  `owner_id` bigint NOT NULL COMMENT '目录所有者账号ID，来源于有效服务端会话，不接受客户端指定所有者',
  `owner_name` varchar(64) DEFAULT NULL COMMENT '创建时所有者展示名，仅作历史展示，不作为授权依据',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_file_directory_name (owner_id,parent_id,name),
  KEY idx_file_directory_parent (owner_id,parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='文件中心逻辑目录；目录与物理存储解耦，支持安全移动且不改正文对象键';

CREATE TABLE `sys_bulk_job` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '导入或导出作业主键，数据库生成；查询和下载仍校验所属账号',
  `created_at` datetime(6) NOT NULL COMMENT '作业创建时间，服务器Asia/Shanghai时区',
  `updated_at` datetime(6) NOT NULL COMMENT '作业状态或进度最近更新时间，由服务器生成',
  `version` bigint DEFAULT NULL COMMENT 'JPA乐观锁版本，防止后台作业状态并发覆盖',
  `owner_id` bigint NOT NULL COMMENT '发起账号ID，取有效会话；只有本人且仍有有效权限时可查询下载',
  `resource` varchar(64) NOT NULL COMMENT '已注册的业务适配器资源名，例如users；不接受SQL、Java类名或任意接口',
  `kind` varchar(16) NOT NULL DEFAULT 'EXPORT' COMMENT '作业类型：IMPORT原子导入、EXPORT异步导出',
  `status` varchar(16) NOT NULL DEFAULT 'QUEUED' COMMENT '作业状态：QUEUED排队、RUNNING执行、SUCCEEDED成功、FAILED失败；进程重启中的导出明确失败',
  `processed_rows` int NOT NULL DEFAULT 0 COMMENT '已处理的数据行数，不含CSV表头；导出每批更新供页面查看进度',
  `total_rows` bigint NOT NULL DEFAULT 0 COMMENT '计划处理的数据行总数，来自授权范围内查询或已校验导入行数',
  `query_json` text COMMENT '导出查询条件的白名单JSON；不保存导入行正文、密码或原始请求体',
  `permission_signature` varchar(64) NOT NULL COMMENT '创建时授权及范围的SHA-256签名；执行和下载重新计算，撤权或范围变化拒绝旧导出',
  `result_key` varchar(64) DEFAULT NULL COMMENT '随机生成的服务端导出临时文件键；未成功或导入作业为空，不向客户端公开',
  `idempotency_key` varchar(64) DEFAULT NULL COMMENT '原子导入的客户端随机幂等键；同账号唯一，导出通常为空，重试不能重复创建账号',
  `input_checksum` varchar(64) DEFAULT NULL COMMENT 'CSV内容的带盐BCrypt慢校验值；仅用于导入幂等，原文件及密码不持久化',
  `failure` varchar(500) DEFAULT NULL COMMENT '对客户可见的脱敏失败原因；不包含密码、SQL、凭据或服务器路径',
  `expires_at` datetime(6) NOT NULL COMMENT '作业结果到期时间；过期后不可下载并清理临时正文，默认创建后24小时',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_bulk_job_idempotency (owner_id,idempotency_key),
  KEY idx_bulk_job_owner (owner_id,created_at),
  KEY idx_bulk_job_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通用批量数据作业的状态与授权快照；密码不入库，导出内容独立临时存储';

CREATE TABLE `sys_change_audit` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '业务变更轨迹主键，数据库生成，与HTTP日志编号不同',
  `created_at` datetime(6) NOT NULL COMMENT '变更事务提交前产生的服务器时间，Asia/Shanghai时区',
  `updated_at` datetime(6) NOT NULL COMMENT '记录生成时间，业务界面不允许修改历史审计',
  `version` bigint DEFAULT NULL COMMENT 'JPA记录版本，审计记录仅追加不提供编辑接口',
  `actor` varchar(64) NOT NULL COMMENT '有效会话中的操作账号名；后台定时维护使用system，不来自客户端',
  `resource` varchar(64) NOT NULL COMMENT '变更对象类型的可读名称，例如用户、角色、内容',
  `resource_id` bigint DEFAULT NULL COMMENT '原业务记录ID；业务删除后仍保留编号，不设置级联删除外键',
  `action` varchar(100) NOT NULL COMMENT '业务动作的可读名称，例如调整角色授权或直接发布',
  `changes_json` text NOT NULL COMMENT '白名单字段的前后差异JSON数组；拒绝密码、令牌、联系方式、正文，随业务失败同步回滚',
  PRIMARY KEY (`id`),
  KEY idx_change_audit_time (created_at),
  KEY idx_change_audit_resource (resource,resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可读业务变更审计，与业务同事务追加；不保存原始请求和秘密字段';

CREATE TABLE `ops_feedback` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '客户反馈主键；匿名接口不按该编号查询，防止枚举其他客户反馈',
  `created_at` datetime(6) NOT NULL COMMENT '反馈提交时间，由服务器生成，Asia/Shanghai时区',
  `updated_at` datetime(6) NOT NULL COMMENT '后台分配、处理或回复的最后更新时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA乐观锁版本；后台处理提交当前值，防止旧弹窗覆盖新回复',
  `receipt_hash` varchar(64) NOT NULL COMMENT '随机48位十六进制查询码的SHA-256摘要；只在创建响应展示一次原码，数据库不保存明码',
  `type` varchar(16) NOT NULL COMMENT '反馈类型：QUESTION使用问题、SUGGESTION建议、CORRECTION内容纠错',
  `title` varchar(160) NOT NULL COMMENT '客户填写的问题或建议标题；纯文本展示，不执行HTML',
  `content` varchar(4000) NOT NULL COMMENT '客户填写的详细说明；长度上限4000，按纯文本展示，不作为脚本或富文本执行',
  `article_id` bigint DEFAULT NULL COMMENT '内容纠错关联的文章编号；可为空，仅供定位，不据此授予文章管理权',
  `contact` varchar(254) DEFAULT NULL COMMENT '客户自愿填写的联系邮箱；仅后台有反馈查看权限者可见，不在匿名查询或审计返回',
  `status` varchar(16) NOT NULL DEFAULT 'OPEN' COMMENT '处理状态：OPEN待处理、PROCESSING处理中、RESOLVED已解决、CLOSED已关闭；解决必须有客户可见回复',
  `assignee_id` bigint DEFAULT NULL COMMENT '分配处理人的账号ID；NULL为未分配，服务端检查有效账号及反馈处理权限',
  `assignee_name` varchar(64) DEFAULT NULL COMMENT '分配时处理人的展示名快照；匿名查询不返回，不作为授权依据',
  `replied_at` datetime(6) DEFAULT NULL COMMENT '最近客户可见回复时间；NULL为未回复，内部备注不更新该字段',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_feedback_receipt (receipt_hash),
  KEY idx_feedback_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='客户反馈处理记录；匿名凭随机查询码访问，后台操作受独立反馈权限控制';

CREATE TABLE `ops_feedback_history` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '反馈处理轨迹主键；按主键稳定排序展示，不提供修改删除接口',
  `created_at` datetime(6) NOT NULL COMMENT '该次处理的服务器时间，Asia/Shanghai时区',
  `updated_at` datetime(6) NOT NULL COMMENT '轨迹生成时间；历史记录不随新回复改写',
  `version` bigint DEFAULT NULL COMMENT 'JPA记录版本，轨迹只追加不编辑',
  `feedback_id` bigint DEFAULT NULL COMMENT '所属反馈主键；服务端从当前锁定反馈取值，不接受客户端替换目标',
  `actor` varchar(64) NOT NULL COMMENT '处理时有效会话的账号名；匿名查询不返回内部人员身份',
  `status` varchar(16) NOT NULL COMMENT '该次处理后的反馈状态：OPEN、PROCESSING、RESOLVED、CLOSED',
  `public_reply` varchar(2000) DEFAULT NULL COMMENT '客户凭查询码可看到的纯文本回复；无公开回复的分配或备注操作可为空',
  `internal_note` varchar(2000) DEFAULT NULL COMMENT '仅后台可见的内部处理备注；匿名查询投影明确排除',
  PRIMARY KEY (`id`),
  KEY idx_feedback_history (feedback_id,id),
  CONSTRAINT fk_feedback_history FOREIGN KEY (feedback_id) REFERENCES ops_feedback(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='客户反馈处理轨迹；公开回复和内部备注分字段保存，匿名响应只返回公开投影';

CREATE TABLE `ops_monitor_sample` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '运行采样主键，由数据库生成',
  `created_at` datetime(6) NOT NULL COMMENT '采样保存的服务器时间；每30秒采样，保留7天',
  `updated_at` datetime(6) NOT NULL COMMENT '记录生成时间；采样历史不提供业务编辑入口',
  `version` bigint DEFAULT NULL COMMENT 'JPA记录版本，采样只追加不编辑',
  `node_id` varchar(36) NOT NULL COMMENT '当前进程启动时生成的UUID，区分多实例采样；不是主机IP或文件路径',
  `heap_used` bigint NOT NULL COMMENT 'JVM已使用堆内存，单位字节，不含数据库或外部存储文件大小',
  `heap_max` bigint NOT NULL COMMENT 'JVM最大堆内存，单位字节；计算使用率时必须大于0',
  `cpu_usage` double NOT NULL COMMENT '当前Java进程CPU使用率，单位百分比0至100；系统不支持时为-1，不伪造0',
  `threads` int NOT NULL COMMENT '当前Java进程活跃线程数，不返回线程栈或名称',
  `database_healthy` bit(1) NOT NULL COMMENT '数据库连接可用性；数据库离线时无法保存该采样，实时接口仍报告失败',
  `database_latency_ms` bigint NOT NULL COMMENT '获取并验证数据库连接耗时，单位毫秒；不等同于具体业务SQL响应时间',
  PRIMARY KEY (`id`),
  KEY idx_monitor_sample_node (node_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='有限保留的进程监控指标历史，不包含环境变量、连接凭据、用户资料或业务数量';

CREATE TABLE `ops_monitor_policy` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '单例策略主键固定1；客户端不能创建新的策略编号',
  `created_at` datetime(6) NOT NULL COMMENT '策略初始化时间，由数据库迁移设置',
  `updated_at` datetime(6) NOT NULL COMMENT '配置或告警冷却时间最后更新的服务器时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA乐观锁版本，保存策略携带当前值防止旧弹窗覆盖',
  `enabled` bit(1) NOT NULL COMMENT '是否启用站内阈值告警；默认关闭，监控采样仍继续',
  `heap_threshold_percent` int NOT NULL COMMENT '堆内存告警使用率阈值，单位百分比，允许50至99，默认85',
  `database_threshold_ms` bigint NOT NULL COMMENT '数据库连接验证延迟阈值，单位毫秒，允许10至60000，默认500',
  `alert_user_id` bigint DEFAULT NULL COMMENT '告警接收账号ID；开启告警必须设置且具有监控查看权，不公开外部联系方式',
  `last_alert_at` datetime(6) DEFAULT NULL COMMENT '最近告警时间；数据库行锁内更新，同一策略30分钟最多提醒一次',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='监控阈值与单人站内提醒策略；独立配置权限、版本保护和数据库告警冷却';

ALTER TABLE ops_file ADD KEY idx_file_owner_directory (owner_id,directory_id,deleted_at);
ALTER TABLE ops_flow_task ADD KEY idx_flow_task_timeout (status,due_at,timeout_notified_at);
ALTER TABLE ops_file ADD CONSTRAINT fk_file_directory FOREIGN KEY (directory_id) REFERENCES ops_file_directory(id);

INSERT INTO ops_monitor_policy(id,created_at,updated_at,version,enabled,heap_threshold_percent,database_threshold_ms) VALUES(1,NOW(6),NOW(6),0,0,85,500);

-- 只登记导航；普通角色不会自动获得导入、催办、永久删除、反馈或监控配置授权。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','客户反馈','feedback','/admin/feedback','feedback:view',130,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='feedback');
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','任务调度','scheduler','/admin/scheduler','scheduler:view',140,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='scheduler');
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','服务监控','monitor','/admin/monitor','monitor:view',150,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='monitor');
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','在线会话','sessions','/admin/sessions','sessions:view',160,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='sessions');
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','变更记录','changes','/admin/changes','logs:view',170,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='changes');


-- 全部建表及基础资料成功后才登记基线；如前面报错，必须停止，不能跳过失败语句。
INSERT INTO flyway_schema_history
  (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
VALUES (1, '20', '<< Flyway Baseline >>', 'BASELINE', '<< Flyway Baseline >>', NULL, LEFT(CURRENT_USER(),100), 0, 1);

-- 安装完成自检：应得到 48 张业务表、483 个业务字段，缺少注释数均为 0。
-- 以下只有元数据查询，不输出用户资料、密码摘要或会话信息。
SELECT COUNT(*) AS business_tables, SUM(table_comment = '') AS missing_table_comments
FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'flyway_schema_history';
SELECT COUNT(*) AS business_columns, SUM(column_comment = '') AS missing_column_comments
FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name <> 'flyway_schema_history';
