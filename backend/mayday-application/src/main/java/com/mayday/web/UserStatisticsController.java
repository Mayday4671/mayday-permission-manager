package com.mayday.web;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.util.BusinessTime;
import com.mayday.common.web.ApiResponse;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.AuditLogMapper;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 所有账号指标复用用户数据范围；活跃人数按成功登录日志去重，不用访问次数或随机数估算。 */
@RestController
@RequestMapping("/api/system/user-statistics")
@RequiredArgsConstructor
public class UserStatisticsController {
  private final UserMapper users;
  private final AuditLogMapper audits;
  private final AccessPolicy access;

  /** 每项指标独立重建范围条件，避免同一包装器上的追加条件互相污染。 */
  private long count(Consumer<QueryWrapper> extra) {
    QueryWrapper scope = access.filter("users", "id");
    extra.accept(scope);
    return users.selectCountByQuery(scope);
  }

  /** 统计窗口只允许 7/30/90 天；账号指标与成功登录均限于当前 SQL 授权范围。 */
  @GetMapping
  @Transactional(readOnly = true)
  public ApiResponse<?> statistics(@RequestParam(defaultValue = "7") int days) {
    access.require("userstats:view");
    access.require("users:view");
    if (!Set.of(7, 30, 90).contains(days)) {
      throw new BusinessException("统计窗口仅支持 7、30 或 90 天");
    }
    var start = BusinessTime.today().minusDays(days - 1).atStartOfDay();
    var end = BusinessTime.today().plusDays(1).atStartOfDay();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("total", count(scope -> {}));
    result.put("enabled", count(scope -> scope.and(new QueryColumn("enabled").eq(true))));
    result.put("disabled", count(scope -> scope.and(new QueryColumn("enabled").eq(false))));
    result.put("newUsers", count(scope -> scope.and(new QueryColumn("created_at").ge(start))));
    result.put("activeUsers", loginCount(start, end, true, true));
    result.put("loginSuccess", loginCount(start, end, false, true));
    // 登录失败没有经过认证的账号归属，不能强行归入某部门；仅有全部用户范围及登录日志权时返回。
    boolean global = access.has("loginlogs:view") && "ALL".equals(access.scope("users"));
    result.put("loginFailure", global ? loginCount(start, end, false, false) : null);
    result.put("from", start.toLocalDate());
    result.put("to", end.minusDays(1).toLocalDate());
    result.put("timezone", BusinessTime.zone().getId());
    List<Map<String, Object>> trend = new ArrayList<>();
    for (int dayOffset = 0; dayOffset < days; dayOffset++) {
      var day = start.plusDays(dayOffset);
      trend.add(
          Map.of(
              "date",
              day.toLocalDate(),
              "newUsers",
              count(
                  scope ->
                      scope
                          .and(new QueryColumn("created_at").ge(day))
                          .and(new QueryColumn("created_at").lt(day.plusDays(1)))),
              "logins",
              loginCount(day, day.plusDays(1), false, true)));
    }
    result.put("trend", trend);
    return ApiResponse.ok(result);
  }

  /** 子查询限定现存授权账号；已删除账号不计入活跃账号口径，统计语句由审计仓储执行。 */
  private long loginCount(
      LocalDateTime start, LocalDateTime end, boolean distinct, boolean success) {
    QueryWrapper known =
        access.filter("users", "id").select(new QueryColumn("username")).from(SysUser.class);
    return ((Number) audits.loginCount(start, end, distinct, success, known)).longValue();
  }
}
