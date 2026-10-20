package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.AuditLogMapper;
import com.mayday.system.model.AuditLog;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryCondition;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 查询、详情、导出与清理共用日志分类边界；登录日志和操作日志不相互混用授权。 */
@Service
@RequiredArgsConstructor
public class AuditQueryService {
  private final AuditLogMapper audits;
  private final AccessPolicy access;

  private String resource(boolean loginOnly) {
    return loginOnly ? "loginlogs" : "logs";
  }

  /** 工作台等聚合入口复用日志分类条件，避免摘要接口绕过两类日志的独立授权。 */
  public static QueryCondition kind(boolean loginOnly) {
    return loginOnly
        ? new QueryColumn("path").eq("/api/auth/login")
        : new QueryColumn("path").ne("/api/auth/login");
  }

  /** 按日期、结果和关键字分页查询当前授权的日志分类；导出同时要求该分类的查看与导出权限，每页最多100条。 */
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
    QueryWrapper filter =
        QueryWrapper.create()
            .where(
                kind(loginOnly)
                    .and(
                        SearchPredicates.contains("username", keyword)
                            .or(SearchPredicates.contains("path", keyword))
                            .or(SearchPredicates.contains("ip", keyword))));
    if (success != null)
      filter.and(success ? new QueryColumn("status").lt(400) : new QueryColumn("status").ge(400));
    if (from != null) filter.and(new QueryColumn("created_at").ge(from.atStartOfDay()));
    if (to != null) filter.and(new QueryColumn("created_at").lt(to.plusDays(1).atStartOfDay()));
    return PageResult.from(
        audits.paginate(
            PageResult.request(page, exporting ? 100 : size), filter.orderBy("id desc")));
  }

  /** 只在当前日志分类内查找指定ID，防止拿登录日志ID绕过操作日志的独立授权；不存在时返回统一业务错误。 */
  @Transactional(readOnly = true)
  public AuditLog detail(boolean loginOnly, Long id) {
    access.require(resource(loginOnly) + ":view");
    return java.util.Optional.ofNullable(
            audits.selectOneByQuery(
                QueryWrapper.create().where(kind(loginOnly).and(new QueryColumn("id").eq(id)))))
        .orElseThrow(() -> new BusinessException("日志不存在"));
  }

  /** 最少保留最近 30 天；独立清理权限不能隐含读取、导出或清理另一类日志的权限。 */
  @Transactional
  public long clean(boolean loginOnly, LocalDate before) {
    access.require(resource(loginOnly) + ":delete");
    if (before == null || before.isAfter(BusinessTime.today().minusDays(30)))
      throw new BusinessException("至少保留最近 30 天的日志");
    return audits.deleteByQuery(
        QueryWrapper.create()
            .where(kind(loginOnly).and(new QueryColumn("created_at").lt(before.atStartOfDay()))));
  }
}
