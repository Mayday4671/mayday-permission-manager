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

-- 只补建导航，不自动授予普通角色权限，不修改已有菜单或业务记录。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','工单管理','workorders','/admin/workorders','workorders:view',200,1,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='workorders');
