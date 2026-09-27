ALTER TABLE sys_entry ADD leader_id BIGINT NULL, ADD icon VARCHAR(64) NULL;
ALTER TABLE sys_entry ADD CONSTRAINT fk_department_leader FOREIGN KEY(leader_id) REFERENCES sys_user(id);
-- 只补充本批已实现的入口。旧角色不自动获得新增模块权限。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',page.name,page.code,page.path,page.permission,page.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '岗位管理' name,'posts' code,'/admin/posts' path,'posts:view' permission,10 sort_order
 UNION ALL SELECT '登录日志','loginlogs','/admin/login-logs','loginlogs:view',11
 UNION ALL SELECT '用户统计','userstats','/admin/user-statistics','userstats:view',12
 UNION ALL SELECT '网站配置','site','/admin/site-settings','settings:view',13
) page WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=page.code OR e.path=page.path));
