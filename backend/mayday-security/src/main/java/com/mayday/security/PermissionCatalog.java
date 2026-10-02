package com.mayday.security;

import java.util.*;

/** 服务端唯一权限字典。菜单只是导航，真正授权使用 resource:action 标识。 新业务接入时先在此注册，再在接口上标注 @PreAuthorize；未知权限一律拒绝保存。 */
public final class PermissionCatalog {
  private PermissionCatalog() {}

  public record Group(String key, String name, Map<String, String> actions, boolean scoped) {}

  private static Map<String, String> actions(String... extras) {
    Map<String, String> map = new LinkedHashMap<>();
    map.put("view", "查看");
    map.put("create", "新增");
    map.put("update", "编辑");
    map.put("delete", "删除");
    for (int i = 0; i < extras.length; i += 2) map.put(extras[i], extras[i + 1]);
    return Collections.unmodifiableMap(map);
  }

  public static final List<Group> GROUPS =
      List.of(
          new Group("dashboard", "工作台", Map.of("view", "查看"), false),
          new Group(
              "users",
              "用户管理",
              actions(
                  "export",
                  "导出",
                  "reset",
                  "重置密码",
                  "assign",
                  "分配角色",
                  "sensitive",
                  "全部联系方式",
                  "email-read",
                  "查看邮箱",
                  "email-write",
                  "修改邮箱",
                  "phone-read",
                  "查看电话",
                  "phone-write",
                  "修改电话"),
              true),
          new Group("roles", "角色权限", actions("grant", "授予权限"), false),
          new Group("departments", "组织部门", actions(), false),
          new Group("posts", "岗位管理", actions(), false),
          new Group("categories", "内容分类", actions(), false),
          new Group("tags", "内容标签", actions(), false),
          new Group("messages", "消息中心", Map.of("view", "查看自己的消息"), false),
          new Group(
              "notifications",
              "通知管理",
              actions("publish", "发布通知", "withdraw", "撤回通知", "all", "管理所有通知"),
              false),
          new Group("files", "文件中心", actions("download", "下载", "all", "管理所有文件"), false),
          new Group(
              "crawler",
              "图片采集",
              actions("run", "运行与规则预览", "stop", "停止任务", "download", "预览与下载图片", "all", "管理所有任务"),
              false),
          new Group("sessions", "在线会话", Map.of("view", "查看", "revoke", "强制下线"), false),
          new Group(
              "loginlogs", "登录日志", Map.of("view", "查看", "export", "导出", "delete", "清理历史日志"), false),
          new Group("userstats", "用户统计", Map.of("view", "查看"), false),
          new Group("monitor", "服务监控", Map.of("view", "查看"), false),
          new Group(
              "relay",
              "UDP 转发",
              Map.of("view", "查看统计", "configure", "配置地址与缓冲", "control", "启动与停止"),
              false),
          new Group("scheduler", "任务调度", actions("execute", "立即执行"), false),
          new Group("approvalcategories", "审批分类", actions(), false),
          new Group("workflows", "流程定义", actions("publish", "发布流程"), false),
          new Group(
              "requests",
              "审批中心",
              Map.of("view", "查看参与的申请", "create", "发起申请", "approve", "审批", "manage", "查看全部申请"),
              false),
          new Group("menus", "菜单管理", actions(), false),
          new Group("dictionaries", "数据字典", actions(), false),
          new Group("settings", "系统参数", actions(), false),
          new Group(
              "notices",
              "内容中心",
              actions("publish", "发布内容", "restore", "恢复内容", "purge", "永久删除"),
              true),
          new Group("workorders", "工单管理", actions(), true),
          // generator:permission-groups
          new Group(
              "logs", "操作日志", Map.of("view", "查看", "export", "导出", "delete", "清理历史日志"), false));
  public static final Set<String> ALL =
      GROUPS.stream()
          .flatMap(
              group -> group.actions().keySet().stream().map(action -> group.key() + ":" + action))
          .collect(java.util.stream.Collectors.toUnmodifiableSet());

  /** 可配置行级数据范围的资源来自唯一权限目录，新增业务不再修改多个硬编码白名单。 */
  public static final Set<String> SCOPED_RESOURCES =
      GROUPS.stream()
          .filter(Group::scoped)
          .map(Group::key)
          .collect(java.util.stream.Collectors.toUnmodifiableSet());

  public static final List<String> SCOPES =
      List.of("SELF", "DEPARTMENT", "DEPARTMENT_TREE", "CUSTOM", "ALL");
}
