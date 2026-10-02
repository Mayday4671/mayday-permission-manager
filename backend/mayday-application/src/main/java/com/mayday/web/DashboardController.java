package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.content.Notice;
import com.mayday.content.NoticeRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.service.AuditQueryService;
import com.mayday.system.repository.AuditRepository;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
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
  private final UserRepository users;
  private final RoleRepository roles;
  private final EntryRepository entries;
  private final NoticeRepository notices;
  private final AuditRepository audits;
  private final AccessPolicy access;
  private final com.mayday.service.ContentService content;

  /** 各指标独立检查资源查看权限，无权返回 null；账号和内容数量继承其记录数据范围。 */
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
                    .and((root, query, criteria) -> criteria.isNull(root.get("deletedAt"))))
            : null);
    result.put(
        "published",
        access.has("notices:view")
            ? notices.count(
                access
                    .<Notice>filter("notices", "authorId")
                    .and((root, query, criteria) -> criteria.isTrue(root.get("published"))))
            : null);
    List<Map<String, Object>> trend = new ArrayList<>();
    if (access.has("logs:view"))
      for (int dayOffset = 6; dayOffset >= 0; dayOffset--) {
        LocalDate date = LocalDate.now().minusDays(dayOffset);
        trend.add(
            Map.of(
                "date",
                date.toString(),
                "count",
                audits.count(
                    AuditQueryService.kind(false)
                        .and(
                            (root, query, criteria) ->
                                criteria.and(
                                    criteria.greaterThanOrEqualTo(
                                        root.get("createdAt"), date.atStartOfDay()),
                                    criteria.lessThan(
                                        root.get("createdAt"),
                                        date.plusDays(1).atStartOfDay()))))));
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
                        .and((root, query, criteria) -> criteria.isNull(root.get("deletedAt"))),
                    PageResult.request(1, 4))
                .map(content::view)
                .getContent()
            : List.of());
    return ApiResponse.ok(result);
  }
}
