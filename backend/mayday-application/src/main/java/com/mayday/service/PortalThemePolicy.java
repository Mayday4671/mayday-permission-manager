package com.mayday.service;

import com.mayday.common.BusinessException;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * 前台主题的唯一服务端契约。配置仅包含枚举、六位颜色、整数和布尔值；拒绝任意 CSS、URL 及未知字段。
 * 新增外观字段可以缺省，兼容已经保存的四字段主题；非法的显式值必须报错，不能静默覆盖客户配置。
 */
@Component
@RequiredArgsConstructor
public class PortalThemePolicy {
  public static final String KEY = "site.theme";
  public static final String DEFAULT_JSON =
      "{\"mode\":\"light\",\"primaryColor\":\"#245da8\",\"borderRadius\":4,\"compact\":false}";
  private static final Set<String> REQUIRED_FIELDS =
      Set.of("mode", "primaryColor", "borderRadius", "compact");
  private static final Set<String> FIELDS =
      Set.of(
          "mode",
          "primaryColor",
          "borderRadius",
          "compact",
          "menuStyle",
          "background",
          "surfaceStyle",
          "contentWidth",
          "chartPalette",
          "successColor",
          "warningColor",
          "errorColor");
  private final JsonMapper json;

  /** 公开响应始终返回完整、已规范化的配置；调用方无需拼接 CSS，也不接收存储中的任意额外键。 */
  public record Theme(
      String mode,
      String primaryColor,
      int borderRadius,
      boolean compact,
      String menuStyle,
      String background,
      String surfaceStyle,
      String contentWidth,
      String chartPalette,
      String successColor,
      String warningColor,
      String errorColor) {}

  /** 严格解析后台提交的前台主题；枚举、颜色与范围均验证，旧版缺省扩展字段自动补齐，显式非法值拒绝保存。 */
  public Theme parse(String text) {
    try {
      Object value =
          json.readerFor(Object.class)
              .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .readValue(text);
      if (!(value instanceof Map<?, ?> fields)
          || !FIELDS.containsAll(fields.keySet())
          || !fields.keySet().containsAll(REQUIRED_FIELDS)) throw new IllegalArgumentException();
      if (!(fields.get("borderRadius") instanceof Integer radius)
          || radius < 0
          || radius > 16
          || !(fields.get("compact") instanceof Boolean compact))
        throw new IllegalArgumentException();
      return new Theme(
          enumField(fields, "mode", null, Set.of("light", "dark", "system")),
          colorField(fields, "primaryColor", null),
          radius,
          compact,
          enumField(fields, "menuStyle", "light", Set.of("light", "dark", "tinted")),
          enumField(fields, "background", "neutral", Set.of("neutral", "slate", "blue", "warm")),
          enumField(fields, "surfaceStyle", "border", Set.of("border", "shadow")),
          enumField(fields, "contentWidth", "full", Set.of("full", "boxed")),
          enumField(fields, "chartPalette", "brand", Set.of("brand", "vivid", "soft")),
          colorField(fields, "successColor", "#52c41a"),
          colorField(fields, "warningColor", "#faad14"),
          colorField(fields, "errorColor", "#ff4d4f"));
    } catch (RuntimeException exception) {
      throw new BusinessException("前台主题格式无效：请使用支持的主题选项、六位十六进制颜色、0–16 的整数圆角及布尔开关");
    }
  }

  private static String enumField(
      Map<?, ?> fields, String key, String fallback, Set<String> options) {
    Object value = fields.containsKey(key) ? fields.get(key) : fallback;
    if (!(value instanceof String text) || !options.contains(text))
      throw new IllegalArgumentException();
    return text;
  }

  private static String colorField(Map<?, ?> fields, String key, String fallback) {
    Object value = fields.containsKey(key) ? fields.get(key) : fallback;
    if (!(value instanceof String text) || !text.matches("#[0-9a-fA-F]{6}"))
      throw new IllegalArgumentException();
    return text.toLowerCase(Locale.ROOT);
  }

  /** 历史异常配置仅影响外观；公开页面使用安全默认值继续提供服务，不暴露非法存储值。 */
  public Theme forPublic(String text) {
    try {
      return parse(text);
    } catch (BusinessException exception) {
      return parse(DEFAULT_JSON);
    }
  }
}
