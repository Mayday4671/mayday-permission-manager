package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.service.SettingService;
import com.mayday.service.UserService;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 网站配置与通用参数共用校验、版本和缓存；组内任一字段失败则整组回滚。 */
@RestController
@RequestMapping("/api/system/site-config")
@RequiredArgsConstructor
public class SiteConfigController {
  private final EntryRepository entries;
  private final AccessPolicy access;
  private final SettingService settings;

  /** 单个站点键的输入值及其原版本；创建用空版本，现存配置必须按读取版本更新。 */
  public record Value(@Size(max = 500) String value, Long version) {}

  /** 配置维护视图仅向 settings:view 用户返回注册站点字段、当前版本及公开预览。 */
  @GetMapping
  public ApiResponse<?> get() {
    access.require("settings:view");
    return ApiResponse.ok(
        Map.of(
            "fields",
            SettingService.SITE_FIELDS,
            "entries",
            entries.findByKindOrderBySortOrderAscIdAsc("settings").stream()
                .filter(entry -> SettingService.SITE_KEYS.containsKey(entry.getCode()))
                .toList(),
            "preview",
            settings.publicValues()));
  }

  /** 只接受注册站点键，逐项检查类型与版本后整组原子保存，事务提交后统一失效缓存。 */
  @PutMapping
  @Transactional
  public ApiResponse<?> update(@Valid @RequestBody Map<String, @Valid Value> values) {
    access.require("settings:update");
    if (!SettingService.SITE_KEYS.keySet().containsAll(values.keySet()))
      throw new BusinessException("未知站点配置");
    var storedEntries = entries.findByKindOrderBySortOrderAscIdAsc("settings");
    values.forEach(
        (code, value) -> {
          if (value == null) throw new BusinessException("配置值不能为空");
          var definition = SettingService.SITE_KEYS.get(code);
          settings.validate(code, value.value(), definition.type());
          var entry =
              storedEntries.stream()
                  .filter(item -> item.getCode().equals(code))
                  .findFirst()
                  .orElse(null);
          if (entry == null) {
            if (value.version() != null)
              throw new org.springframework.dao.OptimisticLockingFailureException("配置已删除");
            entry = new SystemEntry();
            entry.setKind("settings");
            entry.setCode(code);
            entry.setName(definition.label());
          } else UserService.version(entry, value.version());
          entry.setGroupName("网站");
          entry.setValueType(definition.type());
          entry.setBuiltIn(true);
          entry.setValue(value.value());
          entry.setEnabled(true);
          entries.save(entry);
        });
    settings.invalidateAfterCommit();
    return ApiResponse.ok(null);
  }

  /** 手动失效站点缓存是维护动作，必须拥有 settings:update 权限。 */
  @PostMapping("/refresh")
  public ApiResponse<?> refresh() {
    access.require("settings:update");
    settings.clearCache();
    return ApiResponse.ok(null);
  }
}
