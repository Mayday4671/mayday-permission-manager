-- Global login policy is opt-out and remains enabled for existing deployments.
INSERT INTO sys_entry(kind, name, code, value, description, group_name, value_type, built_in, sort_order, enabled, created_at, updated_at, version)
SELECT 'settings', '登录验证码', 'security.loginCaptchaEnabled', 'true', '开启后账号密码登录必须完成滑块验证；关闭后直接验证账号密码。保存立即生效，不影响 MFA 与登录失败限流。', '登录安全', 'BOOLEAN', 1, 0, 1, NOW(6), NOW(6), 0
WHERE NOT EXISTS (SELECT 1 FROM sys_entry WHERE kind = 'settings' AND code = 'security.loginCaptchaEnabled');
