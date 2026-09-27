package com.mayday.web;

import com.mayday.common.*;
import com.mayday.content.*;
import com.mayday.security.AccessPolicy;
import com.mayday.service.AuditQueryService;
import com.mayday.system.repository.*;
import java.time.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** 工作台所有指标来源于数据库，按资源权限决定是否展示；不以虚构数据填充图表。 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DashboardController {
  private final UserRepository users;
  private final RoleRepository roles;
  private final EntryRepository entries;
  private final NoticeRepository notices;
  private final AuditRepository audits;
  private final AccessPolicy access;
  private final com.mayday.service.ContentService content;

  @GetMapping("/dashboard")
  @PreAuthorize("@access.has('dashboard:view')")
  @org.springframework.transaction.annotation.Transactional(readOnly = true)
  public ApiResponse<?> dashboard() {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put(
        "users", access.has("users:view") ? users.count(access.filter("users", "id")) : null);
    result.put("roles", access.has("roles:view") ? roles.count() : null);
    result.put(
        "departments", access.has("departments:view") ? entries.countByKind("departments") : null);
    result.put(
        "notices",
        access.has("notices:view")
            ? notices.count(
                access
                    .<Notice>filter("notices", "authorId")
                    .and((r, q, c) -> c.isNull(r.get("deletedAt"))))
            : null);
    result.put(
        "published",
        access.has("notices:view")
            ? notices.count(
                access
                    .<Notice>filter("notices", "authorId")
                    .and((r, q, c) -> c.isTrue(r.get("published"))))
            : null);
    List<Map<String, Object>> trend = new ArrayList<>();
    if (access.has("logs:view"))
      for (int i = 6; i >= 0; i--) {
        LocalDate date = LocalDate.now().minusDays(i);
        trend.add(
            Map.of(
                "date",
                date.toString(),
                "count",
                audits.count(
                    AuditQueryService.kind(false)
                        .and(
                            (r, q, c) ->
                                c.and(
                                    c.greaterThanOrEqualTo(r.get("createdAt"), date.atStartOfDay()),
                                    c.lessThan(r.get("createdAt"), date.plusDays(1).atStartOfDay()))))));
      }
    result.put("trend", trend);
    result.put(
        "recentLogs",
        access.has("logs:view")
            ? audits.findAll(AuditQueryService.kind(false), PageResult.request(1, 5)).getContent()
            : List.of());
    result.put(
        "recentNotices",
        access.has("notices:view")
            ? notices
                .findAll(
                    access
                        .<Notice>filter("notices", "authorId")
                        .and((r, q, c) -> c.isNull(r.get("deletedAt"))),
                    PageResult.request(1, 4))
                .map(content::view)
                .getContent()
            : List.of());
    return ApiResponse.ok(result);
  }
}
