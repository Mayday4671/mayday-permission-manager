package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.common.BusinessException;
import com.mayday.service.PortalThemePolicy;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** 主题输入不是自由文本：非法类型、额外 CSS 和 URL 均不能进入公开主题契约。 */
class PortalThemePolicyTest {
  private final PortalThemePolicy policy = new PortalThemePolicy(JsonMapper.builder().build());

  @Test
  void acceptsValidThemeAndNormalizesColor() {
    var parsed =
        policy.parse(
            "{\"mode\":\"dark\",\"primaryColor\":\"#AABBCC\",\"borderRadius\":0,\"compact\":true}");
    assertEquals("#aabbcc", parsed.primaryColor());
    assertTrue(parsed.compact());
    assertEquals(0, parsed.borderRadius());
    assertEquals("light", parsed.menuStyle());
    assertEquals("neutral", parsed.background());
    assertEquals("full", parsed.contentWidth());
    assertEquals("#52c41a", parsed.successColor());
  }

  @Test
  void acceptsExtendedAppearanceAndRejectsInvalidExplicitValues() {
    var parsed =
        policy.parse(
            PortalThemePolicy.DEFAULT_JSON.replace(
                "}",
                ",\"menuStyle\":\"dark\",\"background\":\"slate\",\"surfaceStyle\":\"shadow\",\"contentWidth\":\"boxed\",\"chartPalette\":\"soft\",\"successColor\":\"#AABBCC\",\"warningColor\":\"#123456\",\"errorColor\":\"#654321\"}"));
    assertEquals("dark", parsed.menuStyle());
    assertEquals("shadow", parsed.surfaceStyle());
    assertEquals("boxed", parsed.contentWidth());
    assertEquals("soft", parsed.chartPalette());
    assertEquals("#aabbcc", parsed.successColor());
    for (String invalid :
        new String[] {
          "\"menuStyle\":null",
          "\"menuStyle\":\"css\"",
          "\"background\":\"url(x)\"",
          "\"surfaceStyle\":\"none\"",
          "\"contentWidth\":1200",
          "\"chartPalette\":[]",
          "\"successColor\":\"#123\"",
          "\"warningColor\":false",
          "\"errorColor\":\"var(--error)\""
        }) {
      assertThrows(
          BusinessException.class,
          () -> policy.parse(PortalThemePolicy.DEFAULT_JSON.replace("}", "," + invalid + "}")));
    }
  }

  @Test
  void rejectsUntrustedFieldsAndTypes() {
    String base = PortalThemePolicy.DEFAULT_JSON;
    for (String invalid :
        new String[] {
          "null",
          "[]",
          "{}",
          base + " {}",
          base.replace("\"light\"", "\"arbitrary\""),
          base.replace("\"#245da8\"", "\"url(https://example.test)\""),
          base.replace("\"#245da8\"", "null"),
          base.replace(":4", ":17"),
          base.replace(":4", ":-1"),
          base.replace(":4", ":4.5"),
          base.replace(":4", ":\"4\""),
          base.replace("false", "\"false\""),
          base.replace("}", ",\"css\":\"body{}\"}")
        }) assertThrows(BusinessException.class, () -> policy.parse(invalid));
  }

  @Test
  void publicFallbackDoesNotExposeInvalidStoredValues() {
    assertEquals(
        policy.parse(PortalThemePolicy.DEFAULT_JSON), policy.forPublic("invalid legacy content"));
    assertEquals(policy.parse(PortalThemePolicy.DEFAULT_JSON), policy.forPublic(null));
  }
}
