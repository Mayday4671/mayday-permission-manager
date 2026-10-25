-- 三个会话限制作为一个参数原子更新，沿用系统参数权限、版本冲突检测和变更审计。
INSERT INTO sys_entry(kind, name, code, value, description, group_name, value_type, built_in, sort_order, enabled, created_at, updated_at, version)
SELECT 'settings', '登录会话策略', 'security.sessionPolicy', '{"absoluteMinutes":720,"idleMinutes":30,"maxPerUser":5}', '登录有效期、无认证请求超时（分钟）及同时登录上限。缩短时限约束已有登录；调长不延长已签发会话的固定到期时间；并发上限在下次登录时执行。', '登录安全', 'JSON', 1, 1, 1, NOW(6), NOW(6), 0
WHERE NOT EXISTS (SELECT 1 FROM sys_entry WHERE kind = 'settings' AND code = 'security.sessionPolicy');
