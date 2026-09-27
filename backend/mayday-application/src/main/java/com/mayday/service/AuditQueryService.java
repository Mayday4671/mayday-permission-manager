package com.mayday.service;

import com.mayday.common.*;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.AuditLog;
import com.mayday.system.repository.AuditRepository;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 查询、详情、导出与清理共用日志分类边界；登录日志和操作日志不相互混用授权。 */
@Service
@RequiredArgsConstructor
public class AuditQueryService {
  private final AuditRepository audits;
  private final AccessPolicy access;

  private String resource(boolean loginOnly) {
    return loginOnly ? "loginlogs" : "logs";
  }

  /** 工作台等聚合入口复用日志分类条件，避免摘要接口绕过两类日志的独立授权。 */
  public static Specification<AuditLog> kind(boolean loginOnly) {
    return (r, q, c) ->
        loginOnly
            ? c.equal(r.get("path"), "/api/auth/login")
            : c.notEqual(r.get("path"), "/api/auth/login");
  }

  @Transactional(readOnly = true)
  public PageResult<AuditLog> list(
      boolean loginOnly,
      String keyword,
      Boolean success,
      LocalDate from,
      LocalDate to,
      int page,
      int size,
      boolean exporting) {
    access.require(resource(loginOnly) + ":view");
    if (exporting) access.require(resource(loginOnly) + ":export");
    if (from != null && to != null && from.isAfter(to)) throw new BusinessException("开始日期不能晚于结束日期");
    Specification<AuditLog> filter =
        kind(loginOnly)
            .and(
                (r, q, c) ->
                    c.and(
                        c.or(
                            SearchPredicates.contains(c, r.get("username"), keyword),
                            SearchPredicates.contains(c, r.get("path"), keyword),
                            SearchPredicates.contains(c, r.get("ip"), keyword)),
                        success == null
                            ? c.conjunction()
                            : success
                                ? c.lessThan(r.get("status"), 400)
                                : c.greaterThanOrEqualTo(r.get("status"), 400),
                        from == null
                            ? c.conjunction()
                            : c.greaterThanOrEqualTo(r.get("createdAt"), from.atStartOfDay()),
                        to == null
                            ? c.conjunction()
                            : c.lessThan(r.get("createdAt"), to.plusDays(1).atStartOfDay())));
    return PageResult.from(
        audits.findAll(filter, PageResult.request(page, exporting ? 100 : size)));
  }

  @Transactional(readOnly = true)
  public AuditLog detail(boolean loginOnly, Long id) {
    access.require(resource(loginOnly) + ":view");
    return audits
        .findOne(kind(loginOnly).and((r, q, c) -> c.equal(r.get("id"), id)))
        .orElseThrow(() -> new BusinessException("日志不存在"));
  }

  /** 最少保留最近 30 天；独立清理权限不能隐含读取、导出或清理另一类日志的权限。 */
  @Transactional
  public long clean(boolean loginOnly, LocalDate before) {
    access.require(resource(loginOnly) + ":delete");
    if (before == null || before.isAfter(LocalDate.now().minusDays(30)))
      throw new BusinessException("至少保留最近 30 天的日志");
    org.springframework.data.jpa.domain.DeleteSpecification<AuditLog> filter =
        (r, q, c) ->
            c.and(
                loginOnly
                    ? c.equal(r.get("path"), "/api/auth/login")
                    : c.notEqual(r.get("path"), "/api/auth/login"),
                c.lessThan(r.get("createdAt"), before.atStartOfDay()));
    return audits.delete(filter);
  }
}
