-- 门户导航与内容分类解耦：栏目是稳定访问入口，分类只在所属栏目内部筛选。
-- 修订冻结栏目 ID；迁移只补齐旧关系，不改正文、发布指针、审批记录或运营主题。
CREATE TABLE `cms_portal_channel` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '门户栏目主键；内容修订通过此 ID 冻结所属入口',
  `created_at` datetime(6) NOT NULL COMMENT '栏目创建时间；北京时间，应用填充，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '栏目配置最后修改时间；不代表文章发布时间',
  `version` bigint DEFAULT NULL COMMENT '栏目乐观锁版本；编辑请求提交原版本，防止覆盖并发修改',
  `code` varchar(48) NOT NULL COMMENT '唯一访问名称；小写字母数字和短横线，创建后不可改，保持已有书签',
  `name` varchar(40) NOT NULL COMMENT '导航及栏目页名称；不是内容分类名称，不用于鉴权',
  `template` varchar(16) NOT NULL COMMENT '栏目模板：GUIDE知识指南/NOTICE日期公告/UPDATE更新时间轴/STORY图文杂志',
  `description` varchar(500) DEFAULT NULL COMMENT '栏目用途说明；展示于栏目页，服务端限制长度，不执行 HTML',
  `sort_order` int NOT NULL COMMENT '导航显示顺序；升序，同值再按主键排序',
  `enabled` tinyint(1) NOT NULL COMMENT '公开启用标记；停用同步阻断栏目、文章、封面及附件公开访问，不清除数据',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portal_channel_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='门户一级导航；与内容分类独立，模板和顺序由后台配置';

CREATE TABLE `cms_portal_category` (
  `category_id` bigint NOT NULL COMMENT '内容分类主键，外键 sys_entry.id；服务端只接受 categories 类型，每分类只属于一栏目',
  `channel_id` bigint NOT NULL COMMENT '所属门户栏目，外键 cms_portal_channel.id；被历史修订引用后不能迁移或解除归属',
  `sort_order` int NOT NULL COMMENT '栏目内分类显示顺序；由后台关联列表次序产生，不改全局基础资料顺序',
  PRIMARY KEY (`category_id`),
  KEY `idx_portal_category_channel` (`channel_id`),
  CONSTRAINT `fk_portal_category_entry` FOREIGN KEY (`category_id`) REFERENCES `sys_entry` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_portal_category_channel` FOREIGN KEY (`channel_id`) REFERENCES `cms_portal_channel` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='门户栏目内分类归属；分类停用和名称仍由共享基础资料管理';

CREATE TABLE `cms_portal_home` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '首页编排单例主键，固定 1；同时作为栏目写入的事务互斥锁',
  `created_at` datetime(6) NOT NULL COMMENT '首页配置初始化时间；北京时间，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '首页编排或公开主题策略最后修改时间',
  `version` bigint DEFAULT NULL COMMENT '首页独立乐观锁版本；不与文章修订或后台浏览器主题偏好共用',
  `hero_article_id` bigint DEFAULT NULL COMMENT '首页主视觉文章逻辑 ID；为空自动选已公开指南，下线时隐藏，绝不自动发布文章',
  `notice_article_id` bigint DEFAULT NULL COMMENT '首页公告条文章逻辑 ID；只可选择公开公告栏目内容，为空自动选最近公告',
  `featured_article_ids` varchar(600) NOT NULL COMMENT '有序精选文章 ID 数组 JSON，最多 12 篇；空数组自动选择最近公开内容，访问时逐篇校验',
  `allow_theme_toggle` tinyint(1) NOT NULL COMMENT '是否允许访客在本浏览器切换明暗；0 时严格使用网站配置主题，访客不能回写全站',
  `night_primary_color` varchar(7) NOT NULL COMMENT '门户暗夜强调色，格式 #RRGGBB；默认薄荷色，后台管理主题与此独立',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='门户首页编排和访客明暗策略；仅存受支持配置，不存草稿正文或登录凭据';

INSERT INTO cms_portal_channel(code,name,template,description,sort_order,enabled,created_at,updated_at,version) VALUES
 ('guides','使用指南','GUIDE','查找操作步骤、使用说明与常见问题',10,1,NOW(6),NOW(6),0),
 ('notices','公告','NOTICE','查看服务通知与重要事项',20,1,NOW(6),NOW(6),0),
 ('updates','产品动态','UPDATE','查看产品发布与功能变化',30,1,NOW(6),NOW(6),0),
 ('stories','团队故事','STORY','了解团队经验与协作日常',40,1,NOW(6),NOW(6),0);
INSERT INTO cms_portal_home(id,created_at,updated_at,version,featured_article_ids,allow_theme_toggle,night_primary_color)
 VALUES(1,NOW(6),NOW(6),0,'[]',1,'#53d5be');

-- 只在升级阶段兼容原来的四类基础资料；未匹配的旧分类保留在故事栏目，绝不丢弃历史内容。
INSERT INTO cms_portal_category(category_id,channel_id,sort_order)
 SELECT e.id,c.id,e.sort_order FROM sys_entry e JOIN cms_portal_channel c ON c.code =
 CASE e.name WHEN '使用指南' THEN 'guides' WHEN '公告' THEN 'notices' WHEN '产品动态' THEN 'updates' ELSE 'stories' END
 WHERE e.kind='categories';
ALTER TABLE cms_revision ADD COLUMN portal_channel_id bigint DEFAULT NULL COMMENT '随修订冻结的门户栏目 ID；外键 cms_portal_channel.id，分类归属由服务端校验，不按名称推断';
UPDATE cms_revision r JOIN cms_portal_category b ON r.category_id=b.category_id SET r.portal_channel_id=b.channel_id;
ALTER TABLE cms_revision ADD CONSTRAINT fk_revision_portal_channel FOREIGN KEY(portal_channel_id) REFERENCES cms_portal_channel(id);

-- 导航只是入口；内置超级管理员从权限目录解析全量权限，旧角色授权不改，普通角色需明确授权。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
 SELECT 'menus','门户栏目','portal','/admin/portal','portal:view',65,1,NOW(6),NOW(6),0
 WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='portal');
