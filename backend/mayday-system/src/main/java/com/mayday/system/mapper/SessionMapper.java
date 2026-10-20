package com.mayday.system.mapper;

import com.mayday.system.model.LoginSession;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.io.Serializable;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/**
 * 修改密码、停用账号时清除此账号所有令牌。
 *
 * <p>会话以令牌摘要为主键且无版本列，直接继承 BaseMapper 并提供按摘要整行保存的入口。
 */
@Mapper
public interface SessionMapper extends BaseMapper<LoginSession> {
  /** 按摘要主键载入会话；不存在返回空，由认证流程决定是否拒绝。 */
  default Optional<LoginSession> findById(Serializable id) {
    return Optional.ofNullable(selectOneById(id));
  }

  /**
   * 调用方先持有账号行锁，再当前读此账号的会话；不能沿用 MFA/OIDC 早先建立的旧快照判断配额。 登录事务使用
   * READ_COMMITTED，避免空会话范围的间隙锁阻塞其他账号首登；同时间仍按摘要稳定排序。
   */
  default List<LoginSession> findByUserIdOrderByCreatedAtAscTokenHashAsc(Long userId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("user_id").eq(userId))
            .orderBy("created_at asc, token_hash asc")
            .forUpdate());
  }

  /** 按公开 UUID 精确查找撤销目标；调用方仍须独立验证动作、范围及账号管理等级。 */
  default Optional<LoginSession> findBySessionId(String sessionId) {
    LoginSession session =
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("session_id").eq(sessionId)));
    return Optional.ofNullable(session);
  }

  /** 在调用方事务中撤销账号全部会话；修改密码和停用操作应与此删除一起提交。 */
  default void deleteByUserId(Long userId) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("user_id").eq(userId)));
  }

  /** 清理固定有效期已经结束的摘要；不会延长仍有效会话的登录期限。 */
  default void deleteByExpiresAtBefore(Instant now) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("expires_at").lt(now)));
  }

  /** 按令牌摘要整行写入：不存在则插入，存在则覆盖除主键外的全部列。 */
  default LoginSession save(LoginSession session) {
    if (selectOneById(session.getTokenHash()) == null) {
      insert(session, false);
    } else {
      update(session, false);
    }
    return session;
  }

  /** 有效会话条件：固定期限内签发且未过期，活动窗口按无请求超时判断。 */
  default com.mybatisflex.core.query.QueryCondition activeWindow(
      java.time.Instant now, long absoluteSeconds, long idleSeconds) {
    return new QueryColumn("expires_at")
        .gt(now)
        .and(
            new com.mybatisflex.core.query.RawQueryCondition(
                "created_at > ?", now.minusSeconds(absoluteSeconds)))
        .and(
            new com.mybatisflex.core.query.RawQueryCondition(
                "coalesce(last_active_at, created_at) > ?", now.minusSeconds(idleSeconds)));
  }

  /** 按主键集合读取账号展示名；跨表联查由调用方组装。 */
  default java.util.List<com.mybatisflex.core.row.Row> userSnapshots(java.util.List<Long> userIds) {
    if (userIds.isEmpty()) return java.util.List.of();
    return com.mybatisflex.core.row.Db.selectListByQuery(
        "sys_user",
        com.mybatisflex.core.query.QueryWrapper.create()
            .select(new QueryColumn("id"), new QueryColumn("username"), new QueryColumn("nickname"))
            .where(new QueryColumn("id").in(userIds)));
  }
}
