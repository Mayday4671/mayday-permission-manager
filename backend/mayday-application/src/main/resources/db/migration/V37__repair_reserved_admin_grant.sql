-- 恢复初始管理员缺失的内置角色关联；不向其他账号授予管理员权限。
-- 用户名 admin 是平台保留账号，角色 admin 是受保护的超级管理员角色。
-- 新安装由 BootstrapData 写入该关联；本迁移修复历史版本已创建但无角色关联的保留账号。
INSERT INTO sys_user_role (user_id, role_id)
SELECT u.id, r.id
FROM sys_user u
JOIN sys_role r ON r.code = 'admin'
WHERE u.username = 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM sys_user_role existing_role
    WHERE existing_role.user_id = u.id
  );
