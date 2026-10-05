package com.mayday.security;

import com.mayday.common.BusinessException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MySQL 共享验证码及失败窗口。守卫行只保护短状态事务和有界容量，不持锁绘图或比较密码； 凭证取出使用独立事务，消费先提交，后续错误不能重放同题。令牌和来源组合仅存 SHA-256 摘要。
 */
@Component
public class JdbcSecurityState implements SecurityState {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transaction;

  public JdbcSecurityState(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    transaction = new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    transaction.setTimeout(10);
  }

  @Override
  public long now() {
    return jdbc.queryForObject(
        "select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)", Long.class);
  }

  /**
   * 所有安全状态写事务先持有固定守卫，再处理状态/失败窗口行，包括消费和成功清理。 精确主键消费也必须遵守此顺序：过期清理通过到期索引访问同一行，不能与主键删除倒置。
   * 守卫只保护短数据库事务，不跨绘图、密码比较或外部网络请求，也不依靠进程 synchronized。
   */
  private long lock() {
    jdbc.queryForObject("select id from sys_security_guard where id=1 for update", Integer.class);
    long now = now();
    jdbc.update("delete from sys_security_state where expires_at<=?", now);
    jdbc.update("delete from sys_security_rate where expires_at<=?", now);
    return now;
  }

  @Override
  public void reserveChallenge(String source) {
    reserve("captcha", source, 120, 60000);
  }

  @Override
  public void challenge(String token, String subject, String source, String payload, long ttl) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          if (count("sys_security_state") >= 4096 || count("sys_security_rate") >= 10000)
            throw new BusinessException("验证服务繁忙，请稍后再试");
          jdbc.update(
              "delete from sys_security_state where kind='CHALLENGE' and subject_key=?",
              hash(subject));
          insert("CHALLENGE", token, subject, payload, now + ttl);
        });
  }

  @Override
  public void proof(String token, String subject, String payload, long ttl) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          if (count("sys_security_state") >= 4096) throw new BusinessException("验证服务繁忙，请稍后再试");
          insert("PROOF", token, subject, payload, now + ttl);
        });
  }

  private long count(String table) {
    // 表名只能由本类固定常量传入，不来自页面参数。
    return jdbc.queryForObject("select count(*) from " + table, Long.class);
  }

  private void insert(String kind, String token, String subject, String payload, long expiry) {
    jdbc.update(
        "insert into sys_security_state(token_key,kind,subject_key,payload,expires_at) values(?,?,?,?,?)",
        hash(token),
        kind,
        hash(subject),
        payload,
        expiry);
  }

  /** 一次性消费与过期清理共用守卫；独立事务提交后才返回内容，后续业务失败不返还凭证。 */
  @Override
  public String take(String kind, String token) {
    if (token == null || token.length() > 128) return null;
    return transaction.execute(
        status -> {
          long now = lock();
          List<String> rows =
              jdbc.query(
                  "select payload from sys_security_state where token_key=? and kind=? and expires_at>? for update",
                  (result, number) -> result.getString(1),
                  hash(token),
                  kind,
                  now);
          jdbc.update(
              "delete from sys_security_state where token_key=? and kind=?", hash(token), kind);
          return rows.isEmpty() ? null : rows.getFirst();
        });
  }

  @Override
  public boolean allowed(String source, String account) {
    return transaction.execute(
        status -> {
          lock();
          return count("sys_security_rate") < 10000
              && counter(hash("login-source:" + source)) < 100
              && counter(hash("login-account:" + account)) < 5;
        });
  }

  @Override
  public void failed(String source, String account) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          increment(hash("login-source:" + source), now + 900000);
          increment(hash("login-account:" + account), now + 900000);
        });
  }

  private int counter(String key) {
    return jdbc
        .query(
            "select attempts from sys_security_rate where rate_key=?",
            (row, index) -> row.getInt(1),
            key)
        .stream()
        .findFirst()
        .orElse(0);
  }

  private void increment(String key, long expiry) {
    if (counter(key) == 0 && count("sys_security_rate") >= 10000) return;
    jdbc.update(
        "insert into sys_security_rate(rate_key,attempts,expires_at) values(?,1,?) on duplicate key update attempts=least(attempts+1,1000000)",
        key,
        expiry);
  }

  /** 成功清理也先持有守卫，避免失败窗口的主键删除与到期索引清理形成反向锁序。 */
  @Override
  public void succeeded(String account) {
    transaction.executeWithoutResult(
        status -> {
          lock();
          jdbc.update(
              "delete from sys_security_rate where rate_key=?", hash("login-account:" + account));
        });
  }

  /** 公开匿名入口复用共享固定窗口；命名空间由业务常量提供，不接受客户端指定限额或时长。 */
  public void reserve(String purpose, String subject, int limit, long durationMillis) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          String key = hash(purpose + ":" + subject);
          if (counter(key) >= limit) throw new BusinessException("操作过于频繁，请稍后重试");
          if (count("sys_security_rate") >= 10000 && counter(key) == 0)
            throw new BusinessException("服务繁忙，请稍后重试");
          increment(key, now + durationMillis);
        });
  }

  /** 不可逆存储键只用于定位，一次性验证码的安全性仍来自 256 位随机令牌。 */
  private static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException("运行环境缺少 SHA-256", failure);
    }
  }
}
