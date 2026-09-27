package com.mayday.service;

import com.mayday.common.BusinessException;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 前台主题的唯一服务端契约。拒绝任意 CSS、URL、未知字段及越界数字，不能借通用参数接口绕过。 */
@Component
@RequiredArgsConstructor
public class PortalThemePolicy {
  public static final String KEY = "site.theme";
  public static final String DEFAULT_JSON =
      "{\"mode\":\"light\",\"primaryColor\":\"#245da8\",\"borderRadius\":4,\"compact\":false}";
  private static final Set<String> FIELDS =
      Set.of("mode", "primaryColor", "borderRadius", "compact");
  private final JsonMapper json;

  public record Theme(String mode, String primaryColor, int borderRadius, boolean compact) {}

  public Theme parse(String text) {
    try {
      Object value =
          json.readerFor(Object.class)
              .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .readValue(text);
      if (!(value instanceof Map<?, ?> fields) || !fields.keySet().equals(FIELDS))
        throw new IllegalArgumentException();
      if (!(fields.get("mode") instanceof String mode)
          || !Set.of("light", "dark", "system").contains(mode)
          || !(fields.get("primaryColor") instanceof String color)
          || !color.matches("#[0-9a-fA-F]{6}")
          || !(fields.get("borderRadius") instanceof Integer radius)
          || radius < 0
          || radius > 16
          || !(fields.get("compact") instanceof Boolean compact))
        throw new IllegalArgumentException();
      return new Theme(mode, color.toLowerCase(java.util.Locale.ROOT), radius, compact);
    } catch (RuntimeException exception) {
      throw new BusinessException("前台主题格式无效：请选择显示模式、六位十六进制主题色、0–16 的整数圆角及紧凑布局开关");
    }
  }

  /** 升级前缺失或历史异常配置只影响外观，公开页面使用安全默认值继续提供服务。 */
  public Theme forPublic(String text) {
    try {
      return parse(text);
    } catch (BusinessException exception) {
      return new Theme("light", "#245da8", 4, false);
    }
  }
}
