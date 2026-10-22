-- 登记 Telegram 模块菜单；模块默认关闭，权限由角色管理员另行授予，不自动扩大普通用户权限。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','Telegram','telegram','/admin/telegram','telegram:view',120,TRUE,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='telegram');
