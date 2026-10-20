package com.mayday.security.mapper;

import com.mybatisflex.core.row.Db;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 验证码与失败窗口表的 SQL 收口：守卫行锁、有界容量检查与原子自增（ON DUPLICATE KEY）依赖 MySQL 专有语法；语句集中在本层，调用方只负责锁顺序与事务边界。 */
@Mapper
public interface SecurityStateMapper {
  /** 数据库毫秒时间戳；验证码有效期不依赖主机时钟。 */
  default long nowMillis() {
    return ((Number)
            Db.selectObject("select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)"))
        .longValue();
  }

  /** 全部安全状态写事务先锁定固定守卫行；过期清理与主键删除保持同向锁序。 */
  default void lockGuard() {
    Db.selectObject("select id from sys_security_guard where id=1 for update");
  }

  /** 到期验证码与失败窗口先清理，容量统计基于有效数据。 */
  default void purgeExpired(long now) {
    Db.updateBySql("delete from sys_security_state where expires_at<=?", now);
    Db.updateBySql("delete from sys_security_rate where expires_at<=?", now);
  }

  /** 状态/失败窗口表的行数上限检查；表名只能由本层固定常量传入。 */
  default long count(String table) {
    return ((Number) Db.selectObject("select count(*) from " + table)).longValue();
  }

  /** 删除同主题旧挑战，一次性凭证不允许同题共存。 */
  default void deleteChallengesOfSubject(String subjectHash) {
    Db.updateBySql(
        "delete from sys_security_state where kind='CHALLENGE' and subject_key=?", subjectHash);
  }

  /** 写入一条状态行；键、主题均为摘要。 */
  default void insertState(
      String tokenHash, String kind, String subjectHash, String payload, long expiry) {
    Db.updateBySql(
        "insert into sys_security_state(token_key,kind,subject_key,payload,expires_at) values(?,?,?,?,?)",
        tokenHash,
        kind,
        subjectHash,
        payload,
        expiry);
  }

  /** 一次性消费前锁定并读取目标行；到期即失效。 */
  default List<com.mybatisflex.core.row.Row> lockPayload(String tokenHash, String kind, long now) {
    return Db.selectListBySql(
        "select payload from sys_security_state where token_key=? and kind=? and expires_at>? for update",
        tokenHash,
        kind,
        now);
  }

  /** 消费即删除；独立事务提交后才返回内容。 */
  default void deleteConsumed(String tokenHash, String kind) {
    Db.updateBySql("delete from sys_security_state where token_key=? and kind=?", tokenHash, kind);
  }

  /** 失败窗口计数读取；缺失按零处理。 */
  default int attempts(String rateKey) {
    return Db.selectListBySql("select attempts from sys_security_rate where rate_key=?", rateKey)
        .stream()
        .findFirst()
        .map(row -> row.getInt("attempts"))
        .orElse(0);
  }

  /** 原子自增失败窗口；达到上限后不再增长。 */
  default void increment(String rateKey, long expiry) {
    Db.updateBySql(
        "insert into sys_security_rate(rate_key,attempts,expires_at) values(?,1,?) on duplicate key update "
            + "attempts=least(attempts+1,1000000)",
        rateKey,
        expiry);
  }

  /** 登录成功清理该账号失败窗口；不影响来源维度的限流。 */
  default void clearAttempts(String rateKey) {
    Db.updateBySql("delete from sys_security_rate where rate_key=?", rateKey);
  }
}
