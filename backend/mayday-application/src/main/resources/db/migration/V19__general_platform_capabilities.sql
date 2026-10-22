-- 通用能力扩展：只追加表/列及菜单；不覆盖账号、授权、内容、采集或旧文件正文。
-- API上限按字符计算，中文50000字符可能超过TEXT的65535字节；扩大正文容量不改变历史内容。
ALTER TABLE ops_notification MODIFY COLUMN content longtext NOT NULL COMMENT '通知正文HTML或清洗后纯文本；最多50000字符，使用LONGTEXT兼容中文多字节，已发布正文不可原地修改';
ALTER TABLE ops_file
  ADD COLUMN directory_id bigint DEFAULT NULL COMMENT '所属文件目录ID；NULL表示当前所有者的根目录，移动时服务端校验目录所有权',
  ADD COLUMN storage_provider varchar(16) NOT NULL DEFAULT 'MYSQL' COMMENT '正文存储适配器：MYSQL兼容旧记录、LOCAL本地持久目录、S3兼容对象存储；创建后不可由客户端改写',
  ADD COLUMN storage_key varchar(512) DEFAULT NULL COMMENT '服务端生成的正文对象键；旧MYSQL记录为空，不作为公共下载地址或返回前端',
  ADD COLUMN thumbnail_key varchar(512) DEFAULT NULL COMMENT '服务端生成的安全图片缩略图键；不支持缩略图或旧文件为NULL，前端通过鉴权接口访问',
  ADD COLUMN deleted_at datetime(6) DEFAULT NULL COMMENT '移入回收站的服务器时间；NULL表示正常文件，业务引用中的文件禁止回收',
  ADD COLUMN purge_requested_at datetime(6) DEFAULT NULL COMMENT '申请永久删除时间；仅回收文件可申请，由后台先清理外部正文再删除元信息，可失败重试',
  ADD COLUMN purge_error varchar(300) DEFAULT NULL COMMENT '外部存储清理失败的脱敏提示；正文未成功删除时保留元信息，不向页面泄漏凭据或对象路径',
  ADD KEY idx_file_owner_directory (owner_id, directory_id, deleted_at);

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

ALTER TABLE ops_file ADD CONSTRAINT fk_file_directory FOREIGN KEY (directory_id) REFERENCES ops_file_directory(id);

ALTER TABLE ops_flow_task
  ADD COLUMN due_at datetime(6) DEFAULT NULL COMMENT '审批任务到期时间，由已发布流程版本的节点超时分钟数计算；NULL表示未设置超时',
  ADD COLUMN timeout_notified_at datetime(6) DEFAULT NULL COMMENT '已发送本任务一次超时提醒的时间；NULL表示尚未提醒，任务行锁保证并发幂等',
  ADD KEY idx_flow_task_timeout (status,due_at,timeout_notified_at);
ALTER TABLE ops_flow_request
  ADD COLUMN last_reminded_at datetime(6) DEFAULT NULL COMMENT '申请人最近一次手动催办时间；每30分钟最多一次，不改变审批状态和节点授权';
ALTER TABLE ops_job
  ADD COLUMN alert_user_id bigint DEFAULT NULL COMMENT '任务失败提醒的账号ID；NULL表示不提醒，保存时验证有效账号及调度查看权限';
ALTER TABLE ops_job_execution
  MODIFY COLUMN status varchar(16) DEFAULT NULL COMMENT '执行结果状态：SUCCESS成功、FAILED失败；失败结果独立于业务事务保存，不能将请求成功等同于任务成功',
  ADD COLUMN failure_notified_at datetime(6) DEFAULT NULL COMMENT '失败提醒已投递或无有效接收人跳过的时间；NULL为待重试，成功记录不参与提醒队列',
  ADD KEY idx_job_execution_failure (status,failure_notified_at,created_at);

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
