package com.mayday.service;

import com.mayday.common.BusinessException;
import java.util.*;

/** 已实现页面的服务器登记。菜单权限必须与目标页面完全一致，站内地址格式不是授权白名单。 */
public final class NavigationCatalog {
  private NavigationCatalog() {}

  public record Page(String code, String name, String path, String permission) {}

  public static final List<Page> PAGES =
      List.of(
          page("dashboard", "工作台", "/admin"),
          page("users", "用户管理", "/admin/users"),
          page("roles", "角色权限", "/admin/roles"),
          page("departments", "组织部门", "/admin/departments"),
          page("posts", "岗位管理", "/admin/posts"),
          page("notices", "内容中心", "/admin/notices"),
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

  public static boolean matches(String path, String permission) {
    return PAGES.stream()
        .anyMatch(page -> page.path().equals(path) && page.permission().equals(permission));
  }

  public static void validate(String path, String permission, String icon) {
    if (!matches(path, permission)) throw new BusinessException("请选择已实现的页面及其对应访问权限");
    if (icon != null && !icon.isBlank() && !ICONS.contains(icon))
      throw new BusinessException("请选择已登记的菜单图标");
  }
}
