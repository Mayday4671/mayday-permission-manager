package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/** 参数的类型验证、业务读取和公共白名单集中于此。门户不会读取任意 key，也不会返回完整参数表。 所有实例读取数据库快照，不保留可能跨节点失效不一致的本机参数缓存。 */
@Service
@RequiredArgsConstructor
public class SettingService {
  private final EntryRepository entries;
  private final JsonMapper json;
  private final PortalThemePolicy portalTheme;

  /** 内置站点参数的类型、长度和默认值约束；用于保存校验与公开响应白名单，不能由客户端动态扩展。 */
  public record Definition(String key, String label, String type, int maxLength, String fallback) {}

  public static final List<Definition> SITE_FIELDS =
      List.of(
          new Definition("site.name", "站点名称", "TEXT", 40, "Mayday"),
          new Definition("site.description", "站点简介", "TEXT", 500, "团队公告、产品动态与使用指南"),
          new Definition("site.title", "页面标题", "TEXT", 120, ""),
          new Definition("site.keywords", "SEO 关键词", "TEXT", 250, ""),
          new Definition("site.contact", "联系邮箱", "EMAIL", 128, ""),
          new Definition("site.phone", "联系电话", "TEXT", 64, ""),
          new Definition("site.address", "联系地址", "TEXT", 250, ""),
          new Definition("site.copyright", "版权信息", "TEXT", 250, ""),
          new Definition("site.icp", "备案信息", "TEXT", 100, ""),
          new Definition(
              PortalThemePolicy.KEY, "前台主题", "JSON", 500, PortalThemePolicy.DEFAULT_JSON));
  public static final Map<String, Definition> SITE_KEYS;

  static {
    var keys = new LinkedHashMap<String, Definition>();
    SITE_FIELDS.forEach(field -> keys.put(field.key(), field));
    SITE_KEYS = Collections.unmodifiableMap(keys);
  }

  /** 保存前按参数类型验证值；内置键不可换类型，前台主题拒绝任意CSS及未知字段，错误不会写入缓存或数据库。 */
  public void validate(String code, String value, String type) {
    if ("content.requireApproval".equals(code) && !"BOOLEAN".equals(type))
      throw new BusinessException("内容审核参数必须使用 BOOLEAN 类型");
    String text = Objects.toString(value, "");
    var definition = SITE_KEYS.get(code);
    if (definition != null) {
      if (!definition.type().equals(type)) throw new BusinessException("内置参数类型不能改变");
      if (text.length() > definition.maxLength())
        throw new BusinessException(definition.label() + "最多 " + definition.maxLength() + " 字");
      if (code.equals("site.name") && text.isBlank()) throw new BusinessException("站点名称不能为空");
    }
    if (PortalThemePolicy.KEY.equals(code)) portalTheme.parse(text);
    try {
      switch (type) {
        case "TEXT" -> {}
        case "NUMBER" -> new BigDecimal(text);
        case "BOOLEAN" -> {
          if (!Set.of("true", "false").contains(text)) throw new IllegalArgumentException();
        }
        case "JSON" -> {
          if (text.isBlank()
              || json.reader()
                      .with(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                      .readTree(text)
                  == null) throw new IllegalArgumentException();
        }
        case "EMAIL" -> {
          if (!text.isBlank() && !text.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))
            throw new IllegalArgumentException();
        }
        default -> throw new IllegalArgumentException();
      }
    } catch (RuntimeException error) {
      throw new BusinessException("参数值不符合 " + type + " 类型");
    }
  }

  /** 每次按已提交数据库状态读取不可变参数快照；不保留跨请求本机缓存，其他实例保存立即生效。 */
  public Map<String, String> values() {
    var loaded = new LinkedHashMap<String, String>();
    entries.findByKindOrderBySortOrderAscIdAsc("settings").stream()
        .filter(SystemEntry::isEnabled)
        .forEach(entry -> loaded.put(entry.getCode(), Objects.toString(entry.getValue(), "")));
    return Collections.unmodifiableMap(loaded);
  }

  /** 仅返回SITE_FIELDS登记的公开字段，缺省使用安全默认值；内部审核开关等后台参数不会通过门户泄露。 */
  public Map<String, String> publicValues() {
    var values = values();
    var visible = new LinkedHashMap<String, String>();
    SITE_FIELDS.forEach(
        field -> visible.put(field.key(), values.getOrDefault(field.key(), field.fallback())));
    return visible;
  }

  /** 保留既有刷新接口兼容；读取不再保留本机缓存，刷新后所有实例直接读数据库。 */
  public void clearCache() {}

  /** 读取并规范化门户专属主题，历史无效配置回退默认外观；后台个人主题不会改变这个公开配置。 */
  public PortalThemePolicy.Theme publicTheme() {
    return portalTheme.forPublic(
        values().getOrDefault(PortalThemePolicy.KEY, PortalThemePolicy.DEFAULT_JSON));
  }

  /** 仅在参数事务提交后失效缓存，回滚保持原快照；非事务调用立即清除，避免提前读旧值再缓存。 */
  public void invalidateAfterCommit() {
    if (TransactionSynchronizationManager.isSynchronizationActive())
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              clearCache();
            }
          });
    else clearCache();
  }
}
