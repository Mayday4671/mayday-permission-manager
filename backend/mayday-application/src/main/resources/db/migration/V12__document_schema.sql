-- V12：为所有业务表和字段补充中文数据库 COMMENT。
-- 适用 MySQL 8.4；由 Flyway 在 V1–V11 之后执行，不能单独导入空库。
-- 仅修改元数据注释，保留原字段类型、长度、NULL、默认值、自增属性、索引和外键，不更新业务记录。
-- 已执行的 V1–V11 文件保持原样，避免破坏 Flyway 校验和；后续注释变更也必须新增迁移。
-- 表/列含义维护于 database/catalog.mjs，结构及索引说明见 docs/database.md。
-- MySQL DDL 隐式提交：升级前停写并备份，先通过空库和升级副本验证；失败不能依赖事务撤销全部 DDL。
-- FK 是物理外键；“逻辑关联”由业务服务校验/保留历史快照，不表示数据库存在外键。

-- cms_notice：内容主记录及发布状态；当前草稿和线上内容通过不同修订指针隔离，公开查询不读旧正文列
ALTER TABLE `cms_notice`
  COMMENT = '内容主记录及发布状态；当前草稿和线上内容通过不同修订指针隔离，公开查询不读旧正文列',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '旧版兼容标题；当前展示以 draft_revision_id 或 live_revision_id 指向的修订为准',
  MODIFY COLUMN `category` varchar(32) NOT NULL COMMENT '旧版兼容分类名称；当前分类关系使用 cms_revision.category_id',
  MODIFY COLUMN `summary` varchar(500) DEFAULT NULL COMMENT '旧版兼容摘要；不是当前线上内容的权威来源',
  MODIFY COLUMN `content` text NOT NULL COMMENT '旧版兼容正文；新内容正文保存在不可变 cms_revision 中',
  MODIFY COLUMN `published` tinyint(1) NOT NULL COMMENT '旧版兼容发布标记；公开可见性必须同时检查线上修订、删除状态、可见性及下线时间',
  MODIFY COLUMN `author_id` bigint NOT NULL COMMENT '内容所有者账号 ID，逻辑关联 sys_user.id；参与本人数据范围判断',
  MODIFY COLUMN `department_id` bigint DEFAULT NULL COMMENT '所属部门 ID，外键 sys_entry.id；与作者共同决定内容数据范围',
  MODIFY COLUMN `author_name` varchar(64) DEFAULT NULL COMMENT '作者显示名快照；保留历史，不随账号昵称自动改写',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间；NULL 表示不在回收站，非 NULL 禁止公开，恢复不自动重新发布',
  MODIFY COLUMN `draft_revision_id` bigint DEFAULT NULL COMMENT '当前编辑修订 ID，逻辑关联 cms_revision.id；必须属于本文章',
  MODIFY COLUMN `live_revision_id` bigint DEFAULT NULL COMMENT '当前线上修订 ID，逻辑关联 cms_revision.id；NULL 表示未上线，不能用草稿代替',
  MODIFY COLUMN `draft_status` varchar(24) NOT NULL DEFAULT 'DRAFT' COMMENT '当前修订状态摘要：DRAFT/PENDING/APPROVED/REJECTED/PUBLISHED 等，由内容与审核服务维护',
  MODIFY COLUMN `requires_approval` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否要求修订经过审批才能发布；与系统 content.requireApproval 配置共同校验',
  MODIFY COLUMN `published_at` datetime(6) DEFAULT NULL COMMENT '最近一次上线时间；北京时间 DATETIME，公开列表排序与展示使用',
  MODIFY COLUMN `live_offline_at` datetime(6) DEFAULT NULL COMMENT '当前线上修订计划下线时间；NULL 表示无到期时间，公开查询同时检查时效',
  MODIFY COLUMN `scheduled_revision_id` bigint DEFAULT NULL COMMENT '待定时发布的修订 ID，逻辑关联 cms_revision；不是实时草稿引用',
  MODIFY COLUMN `scheduled_publish_at` datetime(6) DEFAULT NULL COMMENT '计划上线时间，北京时间；NULL 表示无待执行上线任务',
  MODIFY COLUMN `scheduled_offline_at` datetime(6) DEFAULT NULL COMMENT '定时发布时附带的计划下线时间；上线后转入 live_offline_at',
  MODIFY COLUMN `scheduled_actor_id` bigint DEFAULT NULL COMMENT '设置排期的账号 ID；执行时重新检查该账号状态、发布权限和内容范围',
  MODIFY COLUMN `schedule_error` varchar(500) DEFAULT NULL COMMENT '最近排期失败原因；用于后台排查，不通过门户公开',
  MODIFY COLUMN `view_count` bigint NOT NULL DEFAULT '0' COMMENT '公开阅读计数；仅统计通过公开可见性检查的阅读上报，不用于权限判断';

-- cms_notice_tag：V3 旧版内容标签兼容表；V9 已迁移为稳定标签 ID，保留用于升级追溯，不作为新修订标签来源
ALTER TABLE `cms_notice_tag`
  COMMENT = 'V3 旧版内容标签兼容表；V9 已迁移为稳定标签 ID，保留用于升级追溯，不作为新修订标签来源',
  MODIFY COLUMN `notice_id` bigint NOT NULL COMMENT '旧内容 ID，外键 cms_notice.id',
  MODIFY COLUMN `tag` varchar(32) NOT NULL COMMENT '旧版标签名称；升级时映射为 sys_entry(kind=tags) 的稳定 ID';

-- cms_publication：内容发布历史；记录上线修订及下线信息，与草稿编辑历史分离
ALTER TABLE `cms_publication`
  COMMENT = '内容发布历史；记录上线修订及下线信息，与草稿编辑历史分离',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `notice_id` bigint NOT NULL COMMENT '内容 ID，外键 cms_notice.id，永久删除文章时级联清理',
  MODIFY COLUMN `revision_id` bigint NOT NULL COMMENT '实际发布的修订 ID，外键 cms_revision.id',
  MODIFY COLUMN `published_at` datetime(6) NOT NULL COMMENT '本次上线时间，北京时间；不是修订创建时间',
  MODIFY COLUMN `offline_at` datetime(6) DEFAULT NULL COMMENT '本次发布结束时间，NULL 表示未记录下线；公开判断仍以主记录线上指针为准',
  MODIFY COLUMN `operator_name` varchar(64) DEFAULT NULL COMMENT '发布或下线操作人显示名快照',
  MODIFY COLUMN `reason` varchar(100) DEFAULT NULL COMMENT '发布/下线原因或来源，例如手动操作、定时发布、旧版迁移',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- cms_revision：内容不可变修订；每次编辑新增版本，审批仅批准绑定修订，不自动批准后续改稿
ALTER TABLE `cms_revision`
  COMMENT = '内容不可变修订；每次编辑新增版本，审批仅批准绑定修订，不自动批准后续改稿',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `notice_id` bigint NOT NULL COMMENT '所属内容 ID，外键 cms_notice.id；永久删除内容时级联删除修订',
  MODIFY COLUMN `revision_number` int NOT NULL COMMENT '文章内递增修订号，与 notice_id 联合唯一；区别于 JPA version',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '本次修订标题；公开接口只读取线上修订标题',
  MODIFY COLUMN `category_id` bigint NOT NULL COMMENT '稳定分类 ID，外键 sys_entry.id 且 kind=categories；引用中不能删除分类',
  MODIFY COLUMN `summary` varchar(500) DEFAULT NULL COMMENT '内容摘要，可为空；用于列表和搜索结果展示',
  MODIFY COLUMN `content` text NOT NULL COMMENT '经后端富文本白名单清理的 HTML 正文；前端阅读时再次过滤',
  MODIFY COLUMN `visibility` varchar(24) NOT NULL DEFAULT 'PUBLIC' COMMENT '可见性：PUBLIC 可公开或 INTERNAL 内部；即使有线上指针，内部修订也不能匿名读取',
  MODIFY COLUMN `cover_id` bigint DEFAULT NULL COMMENT '封面文件 ID，外键 ops_file.id；允许 NULL，公开读取时再次校验文章可见性及图片格式',
  MODIFY COLUMN `sort_order` int NOT NULL DEFAULT '0' COMMENT '内容排序权重；门户按业务排序逻辑使用，不影响授权',
  MODIFY COLUMN `pinned` tinyint(1) NOT NULL DEFAULT '0' COMMENT '置顶标记：1 在门户排序优先，但不能绕过发布或可见性检查',
  MODIFY COLUMN `recommended` tinyint(1) NOT NULL DEFAULT '0' COMMENT '推荐标记：1 可被推荐筛选命中；不等于已发布',
  MODIFY COLUMN `seo_title` varchar(160) DEFAULT NULL COMMENT '本修订 SEO 页面标题；为空时使用内容标题',
  MODIFY COLUMN `seo_keywords` varchar(250) DEFAULT NULL COMMENT '本修订 SEO 关键词；作为文本元信息，不执行 HTML',
  MODIFY COLUMN `seo_description` varchar(500) DEFAULT NULL COMMENT '本修订 SEO 描述；作为文本元信息',
  MODIFY COLUMN `approval_status` varchar(24) NOT NULL DEFAULT 'DRAFT' COMMENT '审批状态：DRAFT/PENDING/APPROVED/REJECTED/WITHDRAWN；状态只授权本修订，不代表已经上线',
  MODIFY COLUMN `approval_request_id` bigint DEFAULT NULL COMMENT '绑定的审批实例 ID，逻辑关联 ops_flow_request.id；审批完成校验双向业务绑定',
  MODIFY COLUMN `editor_id` bigint DEFAULT NULL COMMENT '创建本修订的账号 ID，逻辑关联 sys_user.id；不是内容所有者字段',
  MODIFY COLUMN `editor_name` varchar(64) DEFAULT NULL COMMENT '修订编辑人昵称快照；账号后续改名不追写历史',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- cms_revision_file：修订可下载附件关联；文件公开资格来自已上线修订，不来自文件中心的上传状态
ALTER TABLE `cms_revision_file`
  COMMENT = '修订可下载附件关联；文件公开资格来自已上线修订，不来自文件中心的上传状态',
  MODIFY COLUMN `revision_id` bigint NOT NULL COMMENT '修订 ID，外键 cms_revision.id，随修订删除级联清理',
  MODIFY COLUMN `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；被修订引用时禁止文件中心删除';

-- cms_revision_tag：修订与稳定标签 ID 的多对多快照；修改草稿不会改变线上修订标签
ALTER TABLE `cms_revision_tag`
  COMMENT = '修订与稳定标签 ID 的多对多快照；修改草稿不会改变线上修订标签',
  MODIFY COLUMN `revision_id` bigint NOT NULL COMMENT '修订 ID，外键 cms_revision.id，随修订删除级联清理',
  MODIFY COLUMN `tag_id` bigint NOT NULL COMMENT '标签 ID，外键 sys_entry.id 且 kind=tags；引用中不能删除';

-- ops_delivery：通知对单个账号的投递及阅读状态；通知与收件人联合唯一，接收快照不随组织变更漂移
ALTER TABLE `ops_delivery`
  COMMENT = '通知对单个账号的投递及阅读状态；通知与收件人联合唯一，接收快照不随组织变更漂移',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `notification_id` bigint NOT NULL COMMENT '发布通知 ID，外键 ops_notification.id，随通知删除级联清理',
  MODIFY COLUMN `recipient_id` bigint NOT NULL COMMENT '收件人账号 ID，逻辑关联 sys_user.id；查询必须等于当前会话账号',
  MODIFY COLUMN `recipient_name` varchar(64) NOT NULL COMMENT '发布时收件人昵称快照；保留当时接收记录',
  MODIFY COLUMN `read_at` datetime(6) DEFAULT NULL COMMENT '首次阅读时间；NULL 表示未读，标记已读只能作用于自己的投递',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- ops_event：审批通知可靠投递事件；随业务事务写入，后台工作器单独投递并支持退避重试
ALTER TABLE `ops_event`
  COMMENT = '审批通知可靠投递事件；随业务事务写入，后台工作器单独投递并支持退避重试',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `event_key` varchar(160) NOT NULL COMMENT '业务事件去重键，唯一；同时传入通知 event_key 防止重试重复投递',
  MODIFY COLUMN `request_id` bigint NOT NULL COMMENT '关联审批实例 ID，逻辑关联 ops_flow_request.id',
  MODIFY COLUMN `recipient_id` bigint NOT NULL COMMENT '目标收件账号 ID，逻辑关联 sys_user.id；按生成事件时的业务决定保存',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '通知标题快照',
  MODIFY COLUMN `body` varchar(1000) NOT NULL COMMENT '通知文本摘要，最多 1000 字；不存任意可执行脚本',
  MODIFY COLUMN `status` varchar(16) NOT NULL DEFAULT 'PENDING' COMMENT '投递状态：PENDING 待投递或等待重试、DELIVERED 已投递、SKIPPED 接收账号已删除',
  MODIFY COLUMN `attempts` int NOT NULL DEFAULT '0' COMMENT '失败尝试计数，初始 0、最大记录 10000；指数退避最多一小时，当前持续重试而非达次数终止',
  MODIFY COLUMN `next_attempt_at` datetime(6) NOT NULL COMMENT '下一次允许尝试的北京时间；工作器按状态和时间领取',
  MODIFY COLUMN `last_error` varchar(500) DEFAULT NULL COMMENT '最近失败信息摘要，最多 500 字；后台 manage 权限可查看，不向普通收件人暴露';

-- ops_file：文件元数据；文件正文独立存入 ops_file_payload，下载逐次校验所有权或业务访问资格
ALTER TABLE `ops_file`
  COMMENT = '文件元数据；文件正文独立存入 ops_file_payload，下载逐次校验所有权或业务访问资格',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `name` varchar(255) NOT NULL COMMENT '去除目录部分及控制字符后的原始文件名；不能用作服务器路径',
  MODIFY COLUMN `content_type` varchar(128) NOT NULL COMMENT '响应内容类型；普通附件统一 application/octet-stream，图片封面另做格式检查',
  MODIFY COLUMN `size` bigint NOT NULL COMMENT '文件字节数；当前上传限制为 1 字节至 10 MB',
  MODIFY COLUMN `owner_id` bigint DEFAULT NULL COMMENT '上传者账号 ID，逻辑关联 sys_user.id；NULL 为旧数据，不自动视为公共文件',
  MODIFY COLUMN `owner_name` varchar(64) DEFAULT NULL COMMENT '上传者昵称快照；展示用，不作为授权依据';

-- ops_file_payload：文件二进制正文；与元数据一对一，数据库备份需同时包含此表
ALTER TABLE `ops_file_payload`
  COMMENT = '文件二进制正文；与元数据一对一，数据库备份需同时包含此表',
  MODIFY COLUMN `id` bigint NOT NULL COMMENT '文件主键，同时为 ops_file.id 外键；不自增',
  MODIFY COLUMN `data` longblob NOT NULL COMMENT '原始二进制内容 LONGBLOB；下载采用附件响应，不把上传内容作为页面执行';

-- ops_flow_decision：审批操作及字段变更历史；保留人员节点快照，不反向授予历史操作人当前处理权
ALTER TABLE `ops_flow_decision`
  COMMENT = '审批操作及字段变更历史；保留人员节点快照，不反向授予历史操作人当前处理权',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `request_id` bigint DEFAULT NULL COMMENT '审批实例 ID，逻辑关联 ops_flow_request.id',
  MODIFY COLUMN `actor_id` bigint DEFAULT NULL COMMENT '操作账号 ID，逻辑关联 sys_user.id',
  MODIFY COLUMN `actor_name` varchar(64) DEFAULT NULL COMMENT '操作人昵称快照',
  MODIFY COLUMN `action` varchar(20) DEFAULT NULL COMMENT '操作类型：SUBMIT/APPROVE/REJECT/WITHDRAW/COMMENT/TRANSFER/ADD_SIGN 等服务端定义值',
  MODIFY COLUMN `comment` varchar(500) DEFAULT NULL COMMENT '审批意见或操作说明，最多 500 字',
  MODIFY COLUMN `node_id` varchar(40) DEFAULT NULL COMMENT '操作节点的模型 ID；发起或整体操作可为空',
  MODIFY COLUMN `node_name` varchar(80) DEFAULT NULL COMMENT '操作时节点名称快照',
  MODIFY COLUMN `target_user_id` bigint DEFAULT NULL COMMENT '转交或加签目标账号 ID，逻辑关联 sys_user.id；其他动作可为空',
  MODIFY COLUMN `target_user_name` varchar(64) DEFAULT NULL COMMENT '转交/加签目标昵称快照',
  MODIFY COLUMN `changes_json` longtext COMMENT '字段修改前后值 JSON；历史返回时按读取者可见字段过滤，禁止直接整列公开';

-- ops_flow_definition：流程定义及可编辑草稿；已发布模型存独立版本，不修改运行中实例的审批规则
ALTER TABLE `ops_flow_definition`
  COMMENT = '流程定义及可编辑草稿；已发布模型存独立版本，不修改运行中实例的审批规则',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `name` varchar(100) NOT NULL COMMENT '流程名称；发起时复制为实例名称快照',
  MODIFY COLUMN `code` varchar(64) NOT NULL COMMENT '唯一流程编码；业务识别使用，区别于显示名',
  MODIFY COLUMN `description` varchar(500) DEFAULT NULL COMMENT '流程用途说明',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '是否允许新发起；停用不改变历史版本与已存在申请的快照',
  MODIFY COLUMN `category_id` bigint DEFAULT NULL COMMENT '审批分类 ID，逻辑关联 sys_entry.id 且 kind=approvalcategories',
  MODIFY COLUMN `business_type` varchar(24) NOT NULL DEFAULT 'GENERAL' COMMENT '业务类型：GENERAL 通用表单或 CONTENT 内容修订审核',
  MODIFY COLUMN `draft_schema` longtext COMMENT '当前可编辑模型 JSON；包含表单、节点、条件、范围和动作，经 WorkflowSchema 校验',
  MODIFY COLUMN `published_version_id` bigint DEFAULT NULL COMMENT '最近发布版本 ID，逻辑关联 ops_flow_version.id；NULL 时不可发起新申请';

-- ops_flow_request：审批实例；冻结模型、原始表单和解析人员，当前任务与历史决定另表记录
ALTER TABLE `ops_flow_request`
  COMMENT = '审批实例；冻结模型、原始表单和解析人员，当前任务与历史决定另表记录',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `definition_id` bigint DEFAULT NULL COMMENT '来源流程定义 ID，逻辑关联 ops_flow_definition；历史保留名称及模型快照',
  MODIFY COLUMN `definition_name` varchar(100) DEFAULT NULL COMMENT '发起时流程名称快照',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '申请标题；不是授权依据',
  MODIFY COLUMN `content` text NOT NULL COMMENT '申请说明正文，经富文本清理；详情按参与关系及字段权限返回',
  MODIFY COLUMN `applicant_id` bigint DEFAULT NULL COMMENT '发起账号 ID，逻辑关联 sys_user.id；决定本人申请范围',
  MODIFY COLUMN `applicant_name` varchar(64) DEFAULT NULL COMMENT '发起人昵称快照',
  MODIFY COLUMN `status` varchar(20) NOT NULL COMMENT '申请状态：PENDING 审批中、APPROVED 通过、REJECTED 驳回、WITHDRAWN 撤回',
  MODIFY COLUMN `current_step` int NOT NULL COMMENT 'V3 顺序审批的步骤索引兼容字段；新版以 current_node_id 和待办任务为准',
  MODIFY COLUMN `current_approver_id` bigint DEFAULT NULL COMMENT '旧版单人当前审批人兼容字段；新版多任务处理必须查 ops_flow_task',
  MODIFY COLUMN `definition_version_id` bigint DEFAULT NULL COMMENT '绑定发布版本 ID，逻辑关联 ops_flow_version.id；旧实例导入时补齐',
  MODIFY COLUMN `schema_snapshot` longtext COMMENT '本实例冻结模型 JSON；后续流程发布不能改变其节点与字段规则',
  MODIFY COLUMN `form_data` longtext COMMENT '当前表单值 JSON；审批人仅能修改当前节点授权可写且可读的字段',
  MODIFY COLUMN `resolved_assignees` longtext COMMENT '实例解析的节点审批人快照 JSON；实际处理仍校验账号和当前审批权限',
  MODIFY COLUMN `current_node_id` varchar(40) DEFAULT NULL COMMENT '当前审批节点稳定 ID；与模型 node.id 对应，不是数据库自增 ID',
  MODIFY COLUMN `business_type` varchar(24) NOT NULL DEFAULT 'GENERAL' COMMENT 'GENERAL 通用申请或 CONTENT 内容审核；用于选择业务绑定处理器',
  MODIFY COLUMN `business_id` bigint DEFAULT NULL COMMENT '关联业务主记录 ID；CONTENT 时为 cms_notice.id，逻辑引用',
  MODIFY COLUMN `business_revision_id` bigint DEFAULT NULL COMMENT '关联业务修订 ID；CONTENT 时为 cms_revision.id，只授权这个版本',
  MODIFY COLUMN `completed_at` datetime(6) DEFAULT NULL COMMENT '结束时间；通过、驳回或撤回时写入，审批中为 NULL',
  MODIFY COLUMN `submitted_form_data` longtext COMMENT '发起时的原始表单 JSON，不随节点修改变化；字段读取仍须应用可见性过滤';

-- ops_flow_step：V3 顺序流程审批人列表兼容表；新版流程从版本化 JSON 模型解析，保留旧流程导入依据
ALTER TABLE `ops_flow_step`
  COMMENT = 'V3 顺序流程审批人列表兼容表；新版流程从版本化 JSON 模型解析，保留旧流程导入依据',
  MODIFY COLUMN `definition_id` bigint NOT NULL COMMENT '流程定义 ID，外键 ops_flow_definition.id',
  MODIFY COLUMN `step_index` int NOT NULL COMMENT '旧版步骤索引，从 0 开始，表示列表顺序',
  MODIFY COLUMN `approver_id` bigint NOT NULL COMMENT '旧版指定审批人账号 ID，逻辑关联 sys_user.id';

-- ops_flow_task：实例节点对单个审批人的任务；处理时锁定实例并检查任务归属、动作权限和乐观版本
ALTER TABLE `ops_flow_task`
  COMMENT = '实例节点对单个审批人的任务；处理时锁定实例并检查任务归属、动作权限和乐观版本',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  MODIFY COLUMN `node_id` varchar(40) NOT NULL COMMENT '模型节点稳定 ID，与实例快照中节点对应',
  MODIFY COLUMN `node_name` varchar(80) NOT NULL COMMENT '生成任务时节点名称快照',
  MODIFY COLUMN `assignee_id` bigint NOT NULL COMMENT '待办账号 ID，逻辑关联 sys_user.id；不能由请求参数冒充',
  MODIFY COLUMN `assignee_name` varchar(64) NOT NULL COMMENT '待办人昵称快照',
  MODIFY COLUMN `status` varchar(20) NOT NULL COMMENT '任务状态：PENDING/APPROVED/REJECTED/CANCELLED/TRANSFERRED；非待办不可重复处理',
  MODIFY COLUMN `mandatory` tinyint(1) NOT NULL DEFAULT '0' COMMENT '加签必签标记；1 时必须独立通过，不能被原或签审批人的通过代替',
  MODIFY COLUMN `decided_at` datetime(6) DEFAULT NULL COMMENT '任务已处理时间；尚未处理时为 NULL';

-- ops_flow_version：流程不可变发布版本；申请绑定具体版本并持有模型快照
ALTER TABLE `ops_flow_version`
  COMMENT = '流程不可变发布版本；申请绑定具体版本并持有模型快照',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `definition_id` bigint NOT NULL COMMENT '流程定义 ID，外键 ops_flow_definition.id',
  MODIFY COLUMN `version_number` int NOT NULL COMMENT '定义内递增发布版本号，与 definition_id 联合唯一；区别于 JPA version',
  MODIFY COLUMN `schema_json` longtext NOT NULL COMMENT '发布时完整且已校验的流程/表单 JSON；后续改草稿不能覆盖',
  MODIFY COLUMN `publisher_name` varchar(64) DEFAULT NULL COMMENT '发布操作人昵称快照';

-- ops_job：受控任务调度配置；只执行固定内部处理器，不接受任意类名、脚本或系统命令
ALTER TABLE `ops_job`
  COMMENT = '受控任务调度配置；只执行固定内部处理器，不接受任意类名、脚本或系统命令',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `name` varchar(100) NOT NULL COMMENT '任务显示名称',
  MODIFY COLUMN `handler` varchar(64) NOT NULL COMMENT '固定处理器：SESSION_CLEANUP 清理过期会话或 DATABASE_CHECK 检查数据库',
  MODIFY COLUMN `cron` varchar(100) NOT NULL COMMENT 'Spring 六段 Cron，秒 分 时 日 月 周；应用在保存时校验并计算下一次执行',
  MODIFY COLUMN `description` varchar(500) DEFAULT NULL COMMENT '任务用途说明',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  MODIFY COLUMN `next_run_at` datetime(6) DEFAULT NULL COMMENT '下一次计划执行北京时间；停用任务为 NULL，轮询通过行锁避免重复领取';

-- ops_job_execution：受控调度执行记录；只记录必要的运行结果，不返回用户数等超出调度授权的业务信息
ALTER TABLE `ops_job_execution`
  COMMENT = '受控调度执行记录；只记录必要的运行结果，不返回用户数等超出调度授权的业务信息',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `job_id` bigint DEFAULT NULL COMMENT '任务 ID，逻辑关联 ops_job.id；任务删除后历史可保留',
  MODIFY COLUMN `job_name` varchar(100) DEFAULT NULL COMMENT '执行时任务名称快照',
  MODIFY COLUMN `status` varchar(16) DEFAULT NULL COMMENT '执行结果状态，当前成功写入 SUCCESS；异常日志不等于已成功执行',
  MODIFY COLUMN `result` varchar(1000) DEFAULT NULL COMMENT '脱敏的运行结果说明；不得包含密码、令牌或未经授权的业务聚合数据',
  MODIFY COLUMN `duration_ms` bigint NOT NULL COMMENT '处理器耗时，单位毫秒';

-- ops_message：V3 旧站内信兼容表；V8 已迁移为通知和投递，当前消息接口不以本表为权威来源
ALTER TABLE `ops_message`
  COMMENT = 'V3 旧站内信兼容表；V8 已迁移为通知和投递，当前消息接口不以本表为权威来源',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '旧消息标题；V8 逐条迁移为独立通知',
  MODIFY COLUMN `content` text NOT NULL COMMENT '旧消息纯文本正文；迁移时转义为安全 HTML',
  MODIFY COLUMN `sender_id` bigint DEFAULT NULL COMMENT '旧发送者账号 ID，逻辑关联 sys_user.id',
  MODIFY COLUMN `sender_name` varchar(64) DEFAULT NULL COMMENT '旧发送者昵称快照',
  MODIFY COLUMN `recipient_id` bigint NOT NULL COMMENT '旧接收者账号 ID，逻辑关联 sys_user.id',
  MODIFY COLUMN `read_at` datetime(6) DEFAULT NULL COMMENT '旧阅读时间；迁移保留到 ops_delivery.read_at';

-- ops_notification：通知发布批次；正文、接收目标及每位收件人的阅读状态分别存储，发布后冻结接收者
ALTER TABLE `ops_notification`
  COMMENT = '通知发布批次；正文、接收目标及每位收件人的阅读状态分别存储，发布后冻结接收者',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `title` varchar(160) NOT NULL COMMENT '通知标题，最长 160 字',
  MODIFY COLUMN `summary` varchar(500) DEFAULT NULL COMMENT '通知摘要；列表使用，避免列表返回完整富文本正文',
  MODIFY COLUMN `content` text NOT NULL COMMENT '经白名单过滤的富文本正文；收件人访问还需通知处于有效发布期',
  MODIFY COLUMN `type` varchar(24) NOT NULL COMMENT '通知类别：NOTICE 通知、ANNOUNCEMENT 公告、REMINDER 提醒；由服务端白名单验证',
  MODIFY COLUMN `status` varchar(24) NOT NULL COMMENT '状态：DRAFT 草稿、PUBLISHED 已发布、WITHDRAWN 已撤回；过期还须检查 expires_at',
  MODIFY COLUMN `recipient_type` varchar(24) NOT NULL COMMENT '接收范围：USERS 指定账号、DEPARTMENTS 部门、ROLES 角色、ALL 全部；发布时展开并冻结',
  MODIFY COLUMN `sender_id` bigint DEFAULT NULL COMMENT '创建者账号 ID，逻辑关联 sys_user.id；没有 notifications:all 时仅可管理本人通知',
  MODIFY COLUMN `sender_name` varchar(64) DEFAULT NULL COMMENT '发送者显示名快照；系统事件可使用系统名称',
  MODIFY COLUMN `published_at` datetime(6) DEFAULT NULL COMMENT '本批次发布时间；草稿为 NULL，发布后填写北京时间',
  MODIFY COLUMN `expires_at` datetime(6) DEFAULT NULL COMMENT '到期时间；NULL 不设到期，超过时间收件人不能继续读取正文/附件',
  MODIFY COLUMN `withdrawn_at` datetime(6) DEFAULT NULL COMMENT '撤回时间；撤回后收件人正文与附件访问一并失效',
  MODIFY COLUMN `target_type` varchar(24) DEFAULT NULL COMMENT '可选业务跳转类型，例如审批申请；必须由客户端已登记目标处理',
  MODIFY COLUMN `target_id` bigint DEFAULT NULL COMMENT '业务跳转目标 ID，逻辑引用；跳转后的业务接口仍需独立鉴权',
  MODIFY COLUMN `event_key` varchar(160) DEFAULT NULL COMMENT '可选业务事件唯一键；防止可靠事件重试重复创建通知，普通人工通知可为 NULL',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- ops_notification_file：通知附件关联；关联前检查上传者资格，收件下载复核投递归属、撤回和到期状态
ALTER TABLE `ops_notification_file`
  COMMENT = '通知附件关联；关联前检查上传者资格，收件下载复核投递归属、撤回和到期状态',
  MODIFY COLUMN `notification_id` bigint NOT NULL COMMENT '通知 ID，外键 ops_notification.id，随通知删除级联清理',
  MODIFY COLUMN `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；引用中禁止文件中心删除';

-- ops_notification_target：通知草稿的目标集合；target_id 的实体种类由通知 recipient_type 决定，不能跨种类解释
ALTER TABLE `ops_notification_target`
  COMMENT = '通知草稿的目标集合；target_id 的实体种类由通知 recipient_type 决定，不能跨种类解释',
  MODIFY COLUMN `notification_id` bigint NOT NULL COMMENT '所属通知 ID，外键 ops_notification.id，随通知删除级联清理',
  MODIFY COLUMN `target_id` bigint NOT NULL COMMENT '账号/部门/角色 ID，按 recipient_type 逻辑关联；ALL 不使用目标集合，发布时重新校验权限';

-- ops_request_file：审批实例附件关联；下载同时校验实际参与资格、实例可读字段和附件归属
ALTER TABLE `ops_request_file`
  COMMENT = '审批实例附件关联；下载同时校验实际参与资格、实例可读字段和附件归属',
  MODIFY COLUMN `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  MODIFY COLUMN `file_id` bigint NOT NULL COMMENT '附件 ID，外键 ops_file.id；引用期间禁止文件中心删除';

-- ops_request_step：V3 实例的顺序审批人快照兼容表；新版任务来源为实例模型及 ops_flow_task
ALTER TABLE `ops_request_step`
  COMMENT = 'V3 实例的顺序审批人快照兼容表；新版任务来源为实例模型及 ops_flow_task',
  MODIFY COLUMN `request_id` bigint NOT NULL COMMENT '审批实例 ID，外键 ops_flow_request.id',
  MODIFY COLUMN `step_index` int NOT NULL COMMENT '旧版实例步骤索引，从 0 开始',
  MODIFY COLUMN `approver_id` bigint NOT NULL COMMENT '旧版快照审批人账号 ID，逻辑关联 sys_user.id';

-- sys_audit_log：操作和登录审计；写入及导出记录结果，不记录正文、查询参数、密码或原令牌
ALTER TABLE `sys_audit_log`
  COMMENT = '操作和登录审计；写入及导出记录结果，不记录正文、查询参数、密码或原令牌',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `username` varchar(64) DEFAULT NULL COMMENT '认证账号或 anonymous；登录失败时是请求者声称的用户名，不代表该账号已认证操作',
  MODIFY COLUMN `method` varchar(12) DEFAULT NULL COMMENT 'HTTP 请求方法，例如 GET/POST/PUT/DELETE',
  MODIFY COLUMN `path` varchar(255) DEFAULT NULL COMMENT '请求路径，最多 255 字，不含查询参数；/api/auth/login 用于区分登录日志',
  MODIFY COLUMN `status` int NOT NULL COMMENT 'HTTP 响应状态码；成功与失败均记录，登录失败不可计入活跃用户',
  MODIFY COLUMN `duration_ms` bigint NOT NULL COMMENT '请求处理耗时，单位毫秒；不含后续日志持久化时间',
  MODIFY COLUMN `ip` varchar(64) DEFAULT NULL COMMENT '请求来源地址；默认连接对端地址，不能信任任意客户端转发头',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- sys_dictionary_item：字典类型下的选项；类型停用或选项停用后不再返回给业务选择器
ALTER TABLE `sys_dictionary_item`
  COMMENT = '字典类型下的选项；类型停用或选项停用后不再返回给业务选择器',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `dictionary_id` bigint NOT NULL COMMENT '字典类型 ID，外键 sys_entry.id 且 kind=dictionaries',
  MODIFY COLUMN `label` varchar(100) NOT NULL COMMENT '面向用户的选项名称；可以修改名称而保留稳定 value',
  MODIFY COLUMN `value` varchar(100) NOT NULL COMMENT '同一字典内唯一的实际业务值；与显示名称分离',
  MODIFY COLUMN `color` varchar(20) DEFAULT NULL COMMENT '可选标签颜色标识；仅用于展示，输入由字典接口约束',
  MODIFY COLUMN `sort_order` int NOT NULL COMMENT '显示排序值；升序，同值再按主键排序',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- sys_entry：共用基础资料；kind 隔离部门、菜单、岗位、字典、参数、内容分类标签和审批分类
ALTER TABLE `sys_entry`
  COMMENT = '共用基础资料；kind 隔离部门、菜单、岗位、字典、参数、内容分类标签和审批分类',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `kind` varchar(32) NOT NULL COMMENT '资源类型：departments/menus/posts/dictionaries/settings/categories/tags/approvalcategories；接口逐类鉴权',
  MODIFY COLUMN `name` varchar(100) NOT NULL COMMENT '业务显示名称；分类及标签由应用进一步限制为 32 字',
  MODIFY COLUMN `code` varchar(100) NOT NULL COMMENT '同 kind 内唯一编码；settings 时为参数键，menus 时为已实现页面编码',
  MODIFY COLUMN `value` varchar(2000) DEFAULT NULL COMMENT '通用配置值，最长 2000 字；settings 按 value_type 校验，字典旧汇总值仅作兼容，禁止存凭据',
  MODIFY COLUMN `description` varchar(500) DEFAULT NULL COMMENT '业务用途或参数含义说明；不作为可执行表达式使用',
  MODIFY COLUMN `permission` varchar(100) DEFAULT NULL COMMENT '菜单访问所需权限标识；必须匹配 NavigationCatalog 中的路径登记，非菜单通常为空',
  MODIFY COLUMN `path` varchar(160) DEFAULT NULL COMMENT '菜单前端路由；只接受已实现的后台页面，不作为任意 URL 跳转入口',
  MODIFY COLUMN `parent_id` bigint DEFAULT NULL COMMENT '父基础资料 ID，外键 sys_entry.id 且业务要求同 kind；部门父链检查循环，当前菜单保持平铺分组',
  MODIFY COLUMN `sort_order` int NOT NULL COMMENT '显示排序值；升序，同值再按主键排序',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本',
  MODIFY COLUMN `leader_id` bigint DEFAULT NULL COMMENT '部门负责人账号 ID，外键 sys_user.id；仅 departments 使用，账号删除前需解除负责人关系',
  MODIFY COLUMN `icon` varchar(64) DEFAULT NULL COMMENT '已登记的菜单图标编码；不是 HTML/SVG 源代码',
  MODIFY COLUMN `group_name` varchar(64) NOT NULL DEFAULT '通用' COMMENT '系统参数展示分组；默认通用，仅为分类信息，不授予任何权限',
  MODIFY COLUMN `value_type` varchar(16) NOT NULL DEFAULT 'TEXT' COMMENT '参数类型：TEXT/NUMBER/BOOLEAN/EMAIL/JSON；决定 value 的校验方式，不接受任意类型名',
  MODIFY COLUMN `built_in` tinyint(1) NOT NULL DEFAULT '0' COMMENT '内置参数标记：1 时禁止删除和改编码；不是超级管理员标记';

-- sys_role：授权角色；操作权限和各资源数据范围分别保存，多启用角色按可访问记录取并集
ALTER TABLE `sys_role`
  COMMENT = '授权角色；操作权限和各资源数据范围分别保存，多启用角色按可访问记录取并集',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `code` varchar(64) NOT NULL COMMENT '唯一角色编码；admin 为受保护的超级管理员角色，普通角色不能授予超出自身权限的能力',
  MODIFY COLUMN `name` varchar(64) NOT NULL COMMENT '角色展示名称；不用于鉴权判断',
  MODIFY COLUMN `description` varchar(500) DEFAULT NULL COMMENT '角色职责与授权用途说明',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '角色启用标记；0 时此角色的操作权限和数据范围不参与有效授权',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- sys_role_permission：角色的资源操作权限；独立于导航菜单，标识必须登记在 PermissionCatalog
ALTER TABLE `sys_role_permission`
  COMMENT = '角色的资源操作权限；独立于导航菜单，标识必须登记在 PermissionCatalog',
  MODIFY COLUMN `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  MODIFY COLUMN `permission` varchar(100) NOT NULL COMMENT '资源:操作，例如 users:view、users:email-read；不支持任意通配符，未知标识拒绝保存';

-- sys_role_scope：角色按资源配置的数据范围；只有同时拥有该资源 view 权限的角色参与范围合并
ALTER TABLE `sys_role_scope`
  COMMENT = '角色按资源配置的数据范围；只有同时拥有该资源 view 权限的角色参与范围合并',
  MODIFY COLUMN `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  MODIFY COLUMN `resource` varchar(64) NOT NULL COMMENT '支持数据范围的资源键，来自 PermissionCatalog 的 scoped 目录',
  MODIFY COLUMN `data_scope` varchar(32) DEFAULT NULL COMMENT 'SELF 本人、DEPARTMENT 本部门、DEPARTMENT_TREE 部门及下级、CUSTOM 指定部门、ALL 全部；应用缺省 SELF，未知值不扩权';

-- sys_role_scope_department：CUSTOM 范围的明确部门集合；按角色和资源独立授权，不自动包含下级部门或本人
ALTER TABLE `sys_role_scope_department`
  COMMENT = 'CUSTOM 范围的明确部门集合；按角色和资源独立授权，不自动包含下级部门或本人',
  MODIFY COLUMN `role_id` bigint NOT NULL COMMENT '所属角色 ID，外键 sys_role.id',
  MODIFY COLUMN `resource` varchar(64) NOT NULL COMMENT '数据范围所属资源键，必须在同角色对应资源上选择 CUSTOM',
  MODIFY COLUMN `department_id` bigint NOT NULL COMMENT '授权部门 ID，外键 sys_entry.id；业务要求有效部门，引用中的部门不可删除';

-- sys_session：可撤销的服务端登录会话；只存随机 Bearer 令牌的 SHA-256 摘要，不存原令牌
ALTER TABLE `sys_session`
  COMMENT = '可撤销的服务端登录会话；只存随机 Bearer 令牌的 SHA-256 摘要，不存原令牌',
  MODIFY COLUMN `token_hash` varchar(64) NOT NULL COMMENT '令牌 SHA-256 小写十六进制摘要，64 字符主键；不通过会话列表公开',
  MODIFY COLUMN `user_id` bigint NOT NULL COMMENT '会话账号 ID，外键 sys_user.id；鉴权时重新加载账号状态和角色',
  MODIFY COLUMN `expires_at` timestamp(6) NOT NULL COMMENT '绝对过期时刻，TIMESTAMP 存储时间点；签发后 12 小时，不因活跃时间更新而延长',
  MODIFY COLUMN `session_id` varchar(36) DEFAULT NULL COMMENT '随机 UUID 公开会话标识，唯一；用于列表及撤销接口，不能作为登录令牌使用',
  MODIFY COLUMN `created_at` timestamp(6) NULL DEFAULT NULL COMMENT '会话签发时刻，TIMESTAMP 时间点；V3 前历史会话迁移时回填',
  MODIFY COLUMN `last_active_at` timestamp(6) NULL DEFAULT NULL COMMENT '最近活跃时刻，TIMESTAMP；为减少写入至多约每分钟更新一次',
  MODIFY COLUMN `ip` varchar(64) DEFAULT NULL COMMENT '登录请求来源地址；默认取连接对端，可信代理部署需要另行配置',
  MODIFY COLUMN `device` varchar(255) DEFAULT NULL COMMENT '登录请求 User-Agent 截断至 255 字符；客户端声明信息，不能用于鉴权';

-- sys_user：系统账号；密码只存 BCrypt 摘要，组织及角色关联参与每次请求鉴权
ALTER TABLE `sys_user`
  COMMENT = '系统账号；密码只存 BCrypt 摘要，组织及角色关联参与每次请求鉴权',
  MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增 BIGINT，不承载业务含义',
  MODIFY COLUMN `username` varchar(64) NOT NULL COMMENT '唯一登录名；修改个人资料不能改变此值，内置 admin 账号受保护',
  MODIFY COLUMN `password_hash` varchar(100) NOT NULL COMMENT 'BCrypt 密码摘要，cost=12；禁止保存或返回明文密码',
  MODIFY COLUMN `nickname` varchar(64) NOT NULL COMMENT '显示昵称；不是登录凭据，审计身份以认证账号为准',
  MODIFY COLUMN `email` varchar(128) DEFAULT NULL COMMENT '联系邮箱；用户管理按 users:email-read/write 或 sensitive 权限读写，个人资料允许本人维护',
  MODIFY COLUMN `phone` varchar(32) DEFAULT NULL COMMENT '联系电话；用户管理按 users:phone-read/write 或 sensitive 权限读写，个人资料允许本人维护',
  MODIFY COLUMN `department_id` bigint DEFAULT NULL COMMENT '所属部门 ID，物理外键 sys_entry.id 且业务要求 kind=departments；NULL 表示未分配部门',
  MODIFY COLUMN `enabled` tinyint(1) NOT NULL COMMENT '账号启用标记：0 禁止登录且已有会话不能继续访问；停用同时撤销该账号会话',
  MODIFY COLUMN `created_at` datetime(6) NOT NULL COMMENT '记录创建时间；应用填充，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `updated_at` datetime(6) NOT NULL COMMENT '记录最后修改时间；应用更新，DATETIME 使用北京时间 Asia/Shanghai，微秒精度',
  MODIFY COLUMN `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；新记录从 0 开始，更新时递增，客户端编辑必须提交读取时的版本';

-- sys_user_post：账号与岗位多对多关联；岗位表示任职信息，本表不直接授予操作权限
ALTER TABLE `sys_user_post`
  COMMENT = '账号与岗位多对多关联；岗位表示任职信息，本表不直接授予操作权限',
  MODIFY COLUMN `user_id` bigint NOT NULL COMMENT '账号 ID，外键 sys_user.id',
  MODIFY COLUMN `post_id` bigint NOT NULL COMMENT '岗位 ID，外键 sys_entry.id 且业务要求 kind=posts';

-- sys_user_role：账号与角色多对多关联；联合主键防止重复授权，用户与角色均有物理外键
ALTER TABLE `sys_user_role`
  COMMENT = '账号与角色多对多关联；联合主键防止重复授权，用户与角色均有物理外键',
  MODIFY COLUMN `user_id` bigint NOT NULL COMMENT '账号 ID，外键 sys_user.id',
  MODIFY COLUMN `role_id` bigint NOT NULL COMMENT '角色 ID，外键 sys_role.id；仅启用角色参与授权';

