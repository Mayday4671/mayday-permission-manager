package com.mayday.system.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.system.model.AuditLog;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;

/** 操作元数据查询与历史清理的持久化入口；导出、清理及保留期限制由审计服务单独授权，不能直接暴露仓储。 */
@Mapper
public interface AuditLogMapper extends EntityMapper<AuditLog> {
  /** 统计指定起点之后的操作数量，供工作台汇总；不返回请求正文或账号敏感字段。 */
  default long countByCreatedAtGreaterThanEqual(LocalDateTime time) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("created_at").ge(time)));
  }

  /** 按左闭右开时间窗口统计，避免连续日期的边界操作重复计数。 */
  default long countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(
      LocalDateTime start, LocalDateTime end) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("created_at").ge(start))
            .and(new QueryColumn("created_at").lt(end)));
  }

  /** 登录统计：成功登录限定现存授权账号（子查询由调用方注入范围条件），可选去重活跃口径。 */
  default Object loginCount(
      java.time.LocalDateTime start,
      java.time.LocalDateTime end,
      boolean distinct,
      boolean success,
      com.mybatisflex.core.query.QueryWrapper knownUsers) {
    QueryWrapper query =
        QueryWrapper.create()
            .select(distinct ? "count(distinct username)" : "count(*)")
            .from("sys_audit_log")
            .where(new QueryColumn("path").eq("/api/auth/login"))
            .and(new QueryColumn("created_at").ge(start))
            .and(new QueryColumn("created_at").lt(end))
            .and(success ? new QueryColumn("status").lt(400) : new QueryColumn("status").ge(400));
    if (success) {
      query.and(new QueryColumn("username").in(knownUsers));
    }
    return com.mybatisflex.core.row.Db.selectObject(query);
  }
}
