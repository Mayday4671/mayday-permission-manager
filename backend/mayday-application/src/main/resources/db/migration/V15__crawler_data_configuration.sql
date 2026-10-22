-- 配置与数据使用独立入口。删除有数据的配置只归档，保留文章来源、图片与原所有者授权关系。
-- 旧配置默认未归档；不改动已有文章、文件、任务执行状态、账号或角色授权。
ALTER TABLE `crawl_task`
  ADD COLUMN `archived` bit(1) NOT NULL DEFAULT b'0' COMMENT '配置是否已删除归档；是则隐藏配置并禁止编辑和执行，保留已有图文及原所有者授权，否为正常配置' AFTER `status`;

-- 旧路径继续作为数据入口，避免现有书签和工作区标签失效；只更新系统默认名称。
UPDATE sys_entry SET name='采集数据',updated_at=NOW(6),version=COALESCE(version,0)+1
WHERE kind='menus' AND code='crawler' AND path='/admin/crawler' AND name='图片采集';

-- 配置入口沿用既有查看权限及菜单启用状态；创建、编辑、执行、删除仍逐项验证原操作权限。
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus','采集配置','crawlerconfig','/admin/crawler-config','crawler:view',m.sort_order+1,m.enabled,NOW(6),NOW(6),0
FROM sys_entry m WHERE m.kind='menus' AND m.code='crawler'
AND NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND (code='crawlerconfig' OR path='/admin/crawler-config'));
