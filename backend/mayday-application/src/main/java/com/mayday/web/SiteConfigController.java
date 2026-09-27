package com.mayday.web;

import com.mayday.common.*;
import com.mayday.security.AccessPolicy;
import com.mayday.service.*;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 网站配置与通用参数共用校验、版本和缓存；组内任一字段失败则整组回滚。 */
@RestController
@RequestMapping("/api/system/site-config")
@RequiredArgsConstructor
public class SiteConfigController {
  private final EntryRepository entries;
  private final AccessPolicy access;
  private final SettingService settings;

  public record Value(@Size(max = 500) String value, Long version) {}

  @GetMapping
  public ApiResponse<?> get() {
    access.require("settings:view");
    return ApiResponse.ok(
        Map.of(
            "fields",
            SettingService.SITE_FIELDS,
            "entries",
            entries.findByKindOrderBySortOrderAscIdAsc("settings").stream()
                .filter(e -> SettingService.SITE_KEYS.containsKey(e.getCode()))
                .toList(),
            "preview",
            settings.publicValues()));
  }

  @PutMapping
  @Transactional
  public ApiResponse<?> update(@Valid @RequestBody Map<String, @Valid Value> values) {
    access.require("settings:update");
    if (!SettingService.SITE_KEYS.keySet().containsAll(values.keySet()))
      throw new BusinessException("未知站点配置");
    var all = entries.findByKindOrderBySortOrderAscIdAsc("settings");
    values.forEach(
        (code, value) -> {
          if (value == null) throw new BusinessException("配置值不能为空");
          var definition = SettingService.SITE_KEYS.get(code);
          settings.validate(code, value.value(), definition.type());
          var entry =
              all.stream().filter(item -> item.getCode().equals(code)).findFirst().orElse(null);
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

  @PostMapping("/refresh")
  public ApiResponse<?> refresh() {
    access.require("settings:update");
    settings.clearCache();
    return ApiResponse.ok(null);
  }
}
