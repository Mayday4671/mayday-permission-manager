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
  `bytes` bigint NOT NULL COMMENT '该成功项入库的图片字节数；重复项、网页和失败项为零',
  `error` varchar(300) DEFAULT NULL COMMENT '该项最近一次请求或解析错误；不包含内部堆栈或网页正文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_url` (`task_id`,`kind`,`url_hash`),
  KEY `idx_crawl_queue` (`task_id`,`status`,`id`),
  KEY `idx_crawl_digest` (`task_id`,`digest`,`status`),
  CONSTRAINT `fk_crawl_task` FOREIGN KEY (`task_id`) REFERENCES `crawl_task` (`id`),
  CONSTRAINT `fk_crawl_file` FOREIGN KEY (`file_id`) REFERENCES `ops_file` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='持久采集队列、网页来源、图片结果及失败重试记录';

INSERT INTO sys_entry(kind,name,code,value,description,permission,path,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','图片采集','crawler','','','crawler:view','/admin/crawler',75,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='crawler');
