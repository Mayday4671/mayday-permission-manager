package com.mayday.operations.service;

import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 提醒接收人的最小候选，不复用全站通讯录，不返回账号角色、联系方式或部门资料。 */
@Service
@RequiredArgsConstructor
public class AlertRecipients {
  private final UserMapper users;
  private final AccessPolicy access;

  /** 告警候选的最小信息：ID与显示名；不借任务或监控配置页面提供全站敏感用户资料。 */
  @Schema(
      name = "AlertRecipientOption",
      requiredProperties = {"value", "label"})
  public record Option(Long value, String label) {}

  /** 调用控制器先检查对应操作权限，候选再次验证有效账号与实际业务查看权，查询最多100条。 */
  @Transactional(readOnly = true)
  public List<Option> list(String permission, String keyword) {
    access.require(permission);
    return users
        .paginate(
            1,
            100,
            com.mybatisflex.core.query.QueryWrapper.create()
                .where(new com.mybatisflex.core.query.QueryColumn("enabled").eq(true))
                .and(SearchPredicates.contains("nickname", keyword)))
        .getRecords()
        .stream()
        .filter(user -> access.hasFor(user, permission))
        .map(user -> new Option(user.getId(), user.getNickname()))
        .toList();
  }
}
