-- 智能体模型设置已移入智能体页面，仅隐藏旧系统菜单入口；保留路由以兼容已保存的旧书签。
UPDATE sys_entry
SET enabled = FALSE,
    updated_at = NOW(6),
    version = version + 1
WHERE kind = 'menus'
  AND code = 'agentscope-settings'
  AND enabled = TRUE;
