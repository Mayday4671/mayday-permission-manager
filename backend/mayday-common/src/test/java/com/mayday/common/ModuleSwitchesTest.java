package com.mayday.common;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** 验证模块依赖、关闭后的直接接口、附件和相似路径，避免只隐藏菜单的伪开关。 */
class ModuleSwitchesTest {
  @Test
  void disablingDependenciesAlsoDisablesConsumers() {
    ModuleSwitches modules = new ModuleSwitches();
    modules.setEnabled(
        Map.of("content", false, "portal", true, "notifications", false, "approvals", true));
    assertFalse(modules.isEnabled("portal"));
    assertFalse(modules.isEnabled("approvals"));
    assertTrue(modules.isEnabled("crawler"));
    assertFalse(modules.isEnabled("workorders"));
  }

  @Test
  void disabledModulesBlockCollectionsItemsAndAttachments() {
    ModuleSwitches modules = new ModuleSwitches();
    modules.setEnabled(
        Map.of("content", false, "notifications", false, "crawler", false, "udp", false));
    for (String path :
        new String[] {
          "/api/content/notices",
          "/api/content/notices/1",
          "/api/content/notices/1/revisions/2/files/3",
          "/api/public/site",
          "/api/system/site-config",
          "/api/system/options/categories",
          "/api/system/entries/tags",
          "/api/operations/requests/1/content-files/3",
          "/api/operations/messages/1/attachments/3",
          "/api/crawler/tasks/1/images/2",
          "/api/relay/start"
        }) assertFalse(modules.pathEnabled(path), path);
    assertFalse(modules.permissionEnabled("requests:approve"));
    assertFalse(modules.permissionEnabled("notices:publish"));
    assertTrue(modules.permissionEnabled("users:update"));
    assertTrue(modules.pathEnabled("/api/system/users"));
    assertTrue(modules.pathEnabled("/api/platform/features"));
    assertTrue(modules.pathEnabled("/api/crawler-extra"));
  }

  @Test
  void invalidNamesFailInsteadOfSilentlyLeavingModulesEnabled() {
    ModuleSwitches modules = new ModuleSwitches();
    assertThrows(
        IllegalArgumentException.class, () -> modules.setEnabled(Map.of("approvels", false)));
    assertThrows(IllegalArgumentException.class, () -> modules.isEnabled("unknown"));
  }
}
