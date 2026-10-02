package com.mayday.common;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;

/**
 * 项目级模块开关。配置只在启动时绑定，切换后重启应用，避免执行中的事务遭遇热切换。 关闭模块仅停止入口和任务，不删除表、业务记录或角色授权；再次开启可继续使用旧数据。
 * 核心账号、角色、组织、审计和文件服务不能关闭，确保业务模块共享同一安全基础。
 */
@Component
@ConfigurationProperties(prefix = "mayday.modules")
public class ModuleSwitches {
  private static final Set<String> KEYS =
      Set.of(
          "content",
          "portal",
          "notifications",
          "approvals",
          "crawler",
          "udp",
          "scheduler",
          "workorders"
          // generator:module-keys
          );
  private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();
  private Map<String, Boolean> enabled = new LinkedHashMap<>();

  public Map<String, Boolean> getEnabled() {
    return Map.copyOf(enabled);
  }

  /** 未知名称和 null 值直接拒绝启动，防止拼写错误导致预期关闭的模块仍然可用。 */
  public void setEnabled(Map<String, Boolean> values) {
    if (values == null
        || !KEYS.containsAll(values.keySet())
        || values.values().stream().anyMatch(java.util.Objects::isNull)) {
      throw new IllegalArgumentException("模块配置包含未知名称或空值");
    }
    enabled = new LinkedHashMap<>(values);
  }

  /** 门户依赖内容，审批依赖站内消息；关闭依赖时同时关闭消费模块，不产生孤立入口。 */
  public boolean isEnabled(String module) {
    if (!KEYS.contains(module)) throw new IllegalArgumentException("未知模块：" + module);
    boolean configured = enabled.getOrDefault(module, defaultEnabled(module));
    return configured
        && switch (module) {
          case "portal" -> isEnabled("content");
          case "approvals" -> isEnabled("notifications");
          default -> true;
        };
  }

  private boolean defaultEnabled(String module) {
    return switch (module) {
      case "workorders" -> false;
      // generator:module-defaults
      default -> true;
    };
  }

  public Map<String, Boolean> snapshot() {
    Map<String, Boolean> result = new LinkedHashMap<>();
    KEYS.stream().sorted().forEach(key -> result.put(key, isEnabled(key)));
    return Map.copyOf(result);
  }

  /** 权限目录保留完整注册项；仅在请求授权时过滤关闭模块，不能用超级管理员绕过。 */
  public boolean permissionEnabled(String permission) {
    String resource = permission.split(":", 2)[0];
    String module =
        switch (resource) {
          case "notices", "categories", "tags" -> "content";
          case "notifications", "messages" -> "notifications";
          case "workflows", "requests", "approvalcategories" -> "approvals";
          case "crawler" -> "crawler";
          case "relay" -> "udp";
          case "scheduler" -> "scheduler";
          case "workorders" -> "workorders";
          // generator:permission-modules
          default -> null;
        };
    return module == null || isEnabled(module);
  }

  /**
   * 同一策略保护直接 HTTP 访问、菜单和契约输出。参数/ID 不参与模块判断；路径按完整段匹配， 不使用模糊 startsWith，避免误禁用相似业务名称。未知核心路径交给 MVC 返回标准
   * 404。
   */
  public boolean pathEnabled(String path) {
    Map<String, String> patterns =
        Map.ofEntries(
            Map.entry("/api/public/**", "portal"),
            Map.entry("/api/system/site-config/**", "portal"),
            Map.entry("/api/content/**", "content"),
            Map.entry("/api/system/entries/categories/**", "content"),
            Map.entry("/api/system/entries/tags/**", "content"),
            Map.entry("/api/system/options/categories", "content"),
            Map.entry("/api/system/options/tags", "content"),
            Map.entry("/api/system/entries/approvalcategories/**", "approvals"),
            Map.entry("/api/system/options/approvalcategories", "approvals"),
            Map.entry("/api/operations/workflows/**", "approvals"),
            Map.entry("/api/operations/requests/**", "approvals"),
            Map.entry("/api/operations/messages/**", "notifications"),
            Map.entry("/api/operations/notifications/**", "notifications"),
            Map.entry("/api/operations/people", "notifications"),
            Map.entry("/api/operations/scheduler/**", "scheduler"),
            Map.entry("/api/operations/job-logs/**", "scheduler"),
            Map.entry("/api/crawler/**", "crawler"),
            Map.entry("/api/relay/**", "udp"),
            Map.entry("/api/business/workorders/**", "workorders")
            // generator:api-modules
            );
    return patterns.entrySet().stream()
        .noneMatch(
            entry -> PATH_MATCHER.match(entry.getKey(), path) && !isEnabled(entry.getValue()));
  }
}
