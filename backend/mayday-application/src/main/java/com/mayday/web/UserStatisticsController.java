package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.AuditLog;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
  private final UserRepository users;
  private final AccessPolicy access;
  private final EntityManager entityManager;

  /** 统计窗口只允许 7/30/90 天；账号指标与成功登录均限于当前 SQL 授权范围。 */
  @GetMapping
  @Transactional(readOnly = true)
  public ApiResponse<?> statistics(@RequestParam(defaultValue = "7") int days) {
    access.require("userstats:view");
    access.require("users:view");
    if (!Set.of(7, 30, 90).contains(days)) throw new BusinessException("统计窗口仅支持 7、30 或 90 天");
    var scope = access.<SysUser>filter("users", "id");
    var start = LocalDate.now().minusDays(days - 1).atStartOfDay();
    var end = LocalDate.now().plusDays(1).atStartOfDay();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("total", users.count(scope));
    result.put(
        "enabled",
        users.count(scope.and((root, query, criteria) -> criteria.isTrue(root.get("enabled")))));
    result.put(
        "disabled",
        users.count(scope.and((root, query, criteria) -> criteria.isFalse(root.get("enabled")))));
    result.put(
        "newUsers",
        users.count(
            scope.and(
                (root, query, criteria) ->
                    criteria.greaterThanOrEqualTo(root.get("createdAt"), start))));
    result.put("activeUsers", loginCount(start, end, true, true));
    result.put("loginSuccess", loginCount(start, end, false, true));
    // 登录失败没有经过认证的账号归属，不能强行归入某部门；仅有全部用户范围及登录日志权时返回。
    boolean global = access.has("loginlogs:view") && "ALL".equals(access.scope("users"));
    result.put("loginFailure", global ? loginCount(start, end, false, false) : null);
    result.put("from", start.toLocalDate());
    result.put("to", end.minusDays(1).toLocalDate());
    result.put("timezone", ZoneId.systemDefault().getId());
    List<Map<String, Object>> trend = new ArrayList<>();
    for (int dayOffset = 0; dayOffset < days; dayOffset++) {
      var day = start.plusDays(dayOffset);
      trend.add(
          Map.of(
              "date",
              day.toLocalDate(),
              "newUsers",
              users.count(
                  scope.and(
                      (root, query, criteria) ->
                          criteria.and(
                              criteria.greaterThanOrEqualTo(root.get("createdAt"), day),
                              criteria.lessThan(root.get("createdAt"), day.plusDays(1))))),
              "logins",
              loginCount(day, day.plusDays(1), false, true)));
    }
    result.put("trend", trend);
    return ApiResponse.ok(result);
  }

  /** 子查询限定现存授权账号；已删除账号不计入活跃账号口径，用户名创建后不可修改。 */
  private long loginCount(
      LocalDateTime start, LocalDateTime end, boolean distinct, boolean success) {
    var builder = entityManager.getCriteriaBuilder();
    var query = builder.createQuery(Long.class);
    var audit = query.from(AuditLog.class);
    var known = query.subquery(String.class);
    var user = known.from(SysUser.class);
    known
        .select(user.get("username"))
        .where(access.<SysUser>filter("users", "id").toPredicate(user, query, builder));
    query.select(distinct ? builder.countDistinct(audit.get("username")) : builder.count(audit));
    query.where(
        builder.equal(audit.get("path"), "/api/auth/login"),
        builder.greaterThanOrEqualTo(audit.get("createdAt"), start),
        builder.lessThan(audit.get("createdAt"), end),
        success
            ? builder.lessThan(audit.get("status"), 400)
            : builder.greaterThanOrEqualTo(audit.get("status"), 400),
        success ? audit.get("username").in(known) : builder.conjunction());
    return entityManager.createQuery(query).getSingleResult();
  }
}
