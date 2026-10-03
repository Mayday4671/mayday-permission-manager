package com.mayday.service;

import com.mayday.common.BusinessException;
import java.util.List;
import java.util.Set;

/** 已实现页面的服务器登记。菜单权限必须与目标页面完全一致，站内地址格式不是授权白名单。 */
public final class NavigationCatalog {
  private NavigationCatalog() {}

  /** 已实现后台页面的固定路由、业务名称和查看权限；数据库菜单只能引用这些登记，不构成独立授权。 */
  public record Page(String code, String name, String path, String permission) {}

  public static final List<Page> PAGES =
      List.of(
          page("dashboard", "工作台", "/admin"),
          page("users", "用户管理", "/admin/users"),
          page("roles", "角色权限", "/admin/roles"),
          page("departments", "组织部门", "/admin/departments"),
          page("posts", "岗位管理", "/admin/posts"),
          page("notices", "内容中心", "/admin/notices"),
          page("portal", "门户栏目", "/admin/portal"),
          page("menus", "菜单管理", "/admin/menus"),
          page("dictionaries", "数据字典", "/admin/dictionaries"),
          page("settings", "系统参数", "/admin/settings"),
          page("logs", "操作日志", "/admin/logs"),
          page("loginlogs", "登录日志", "/admin/login-logs"),
          page("userstats", "用户统计", "/admin/user-statistics"),
          new Page("site", "网站配置", "/admin/site-settings", "settings:view"),
          page("notifications", "通知管理", "/admin/notifications"),
          page("messages", "个人收件箱", "/admin/messages"),
          page("files", "文件中心", "/admin/files"),
          page("relay", "UDP 转发", "/admin/udp-relay"),
          page("crawler", "采集数据", "/admin/crawler"),
          new Page("crawlerconfig", "采集配置", "/admin/crawler-config", "crawler:view"),
          page("categories", "内容分类", "/admin/categories"),
          page("tags", "内容标签", "/admin/tags"),
          new Page("recycle", "内容回收站", "/admin/recycle", "notices:view"),
          page("approvalcategories", "审批分类", "/admin/approval-categories"),
          page("workflows", "流程定义", "/admin/workflows"),
          page("requests", "审批申请", "/admin/requests"),
          page("workorders", "工单管理", "/admin/workorders"),
          page("feedback", "客户反馈", "/admin/feedback"),
          page("scheduler", "任务调度", "/admin/scheduler"),
          page("monitor", "服务监控", "/admin/monitor"),
          page("sessions", "在线会话", "/admin/sessions"),
          new Page("changes", "变更记录", "/admin/changes", "logs:view"),
          // generator:navigation-pages
          new Page("tasks", "审批待办", "/admin/tasks", "requests:approve"));

  private static Page page(String code, String name, String path) {
    return new Page(code, name, path, code + ":view");
  }

  public static final Set<String> ICONS =
      Set.of(
          "dashboard",
          "users",
          "roles",
          "departments",
          "menus",
          "notices",
          "dictionaries",
          "settings",
          "logs");

  /** 校验路由与对应查看权限的完整组合，拒绝把低权限菜单配置成高权限页面入口。 */
  public static boolean matches(String path, String permission) {
    return PAGES.stream()
        .anyMatch(page -> page.path().equals(path) && page.permission().equals(permission));
  }

  /** 保存菜单前验证页面与图标白名单；不接受任意外链、未实现页面或伪造权限配对。 */
  public static void validate(String path, String permission, String icon) {
    if (!matches(path, permission)) throw new BusinessException("请选择已实现的页面及其对应访问权限");
    if (icon != null && !icon.isBlank() && !ICONS.contains(icon))
      throw new BusinessException("请选择已登记的菜单图标");
  }
}
