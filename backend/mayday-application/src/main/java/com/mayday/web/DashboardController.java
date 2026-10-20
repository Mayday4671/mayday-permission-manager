package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessTime;
import com.mayday.common.PageResult;
import com.mayday.content.mapper.NoticeMapper;
import com.mayday.security.AccessPolicy;
import com.mayday.service.AuditQueryService;
import com.mayday.system.mapper.AuditLogMapper;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.mapper.RoleMapper;
import com.mayday.system.mapper.UserMapper;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 工作台所有指标来源于数据库，按资源权限决定是否展示；不以虚构数据填充图表。 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DashboardController {
  private final UserMapper users;
  private final RoleMapper roles;
  private final EntryMapper entries;
  private final NoticeMapper notices;
  private final AuditLogMapper audits;
  private final AccessPolicy access;
  private final com.mayday.service.ContentService content;

  /** 各指标独立检查资源查看权限，无权返回 null；账号和内容数量继承其记录数据范围。 */
  @GetMapping("/dashboard")
  @PreAuthorize("@access.has('dashboard:view')")
  @org.springframework.transaction.annotation.Transactional(readOnly = true)
  public ApiResponse<?> dashboard() {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put(
        "users",
        access.has("users:view") ? users.selectCountByQuery(access.filter("users", "id")) : null);
    result.put("roles", access.has("roles:view") ? roles.count() : null);
    result.put(
        "departments", access.has("departments:view") ? entries.countByKind("departments") : null);
    result.put(
        "notices",
        access.has("notices:view")
            ? notices.selectCountByQuery(
                access
                    .filter("notices", "author_id")
                    .and(new com.mybatisflex.core.query.QueryColumn("deleted_at").isNull()))
            : null);
    result.put(
        "published",
        access.has("notices:view")
            ? notices.selectCountByQuery(
                access
                    .filter("notices", "author_id")
                    .and(new com.mybatisflex.core.query.QueryColumn("published").eq(true)))
            : null);
    List<Map<String, Object>> trend = new ArrayList<>();
    if (access.has("logs:view"))
      for (int dayOffset = 6; dayOffset >= 0; dayOffset--) {
        LocalDate date = BusinessTime.today().minusDays(dayOffset);
        trend.add(
            Map.of(
                "date",
                date.toString(),
                "count",
                audits.selectCountByQuery(
                    com.mybatisflex.core.query.QueryWrapper.create()
                        .where(
                            AuditQueryService.kind(false)
                                .and(
                                    new com.mybatisflex.core.query.QueryColumn("created_at")
                                        .ge(date.atStartOfDay()))
                                .and(
                                    new com.mybatisflex.core.query.QueryColumn("created_at")
                                        .lt(date.plusDays(1).atStartOfDay()))))));
      }
    result.put("trend", trend);
    result.put(
        "recentLogs",
        access.has("logs:view")
            ? audits
                .paginate(
                    PageResult.request(1, 5),
                    com.mybatisflex.core.query.QueryWrapper.create()
                        .where(AuditQueryService.kind(false))
                        .orderBy("id desc"))
                .getRecords()
            : List.of());
    result.put(
        "recentNotices",
        access.has("notices:view")
            ? notices
                .paginate(
                    PageResult.request(1, 4),
                    access
                        .filter("notices", "author_id")
                        .and(new com.mybatisflex.core.query.QueryColumn("deleted_at").isNull())
                        .orderBy("id desc"))
                .map(content::view)
                .getRecords()
            : List.of());
    return ApiResponse.ok(result);
  }
}
