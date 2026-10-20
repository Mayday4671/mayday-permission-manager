package com.mayday.security;

import com.mayday.common.exception.BusinessException;
import com.mayday.security.mapper.SecurityStateMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MySQL 共享验证码及失败窗口。守卫行只保护短状态事务和有界容量，不持锁绘图或比较密码； 凭证取出使用独立事务，消费先提交，后续错误不能重放同题。令牌和来源组合仅存 SHA-256 摘要。
 * SQL 收口在 {@link SecurityStateMapper}，本类只维护锁顺序与事务边界。
 */
@Component
public class SecurityStateStore implements SecurityState {
  private final SecurityStateMapper store;
  private final TransactionTemplate transaction;

  public SecurityStateStore(SecurityStateMapper store, PlatformTransactionManager manager) {
    this.store = store;
    transaction = new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    transaction.setTimeout(10);
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

  @Override
  public long now() {
    return store.nowMillis();
  }

  /**
   * 所有安全状态写事务先持有固定守卫，再处理状态/失败窗口行，包括消费和成功清理。 精确主键消费也必须遵守此顺序：过期清理通过到期索引访问同一行，不能与主键删除倒置。
   * 守卫只保护短数据库事务，不跨绘图、密码比较或外部网络请求，也不依靠进程 synchronized。
   */
  private long lock() {
    store.lockGuard();
    long now = now();
    store.purgeExpired(now);
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
          if (store.count("sys_security_state") >= 4096
              || store.count("sys_security_rate") >= 10000) {
            throw new BusinessException("验证服务繁忙，请稍后再试");
          }
          store.deleteChallengesOfSubject(hash(subject));
          store.insertState(hash(token), "CHALLENGE", hash(subject), payload, now + ttl);
        });
  }

  @Override
  public void proof(String token, String subject, String payload, long ttl) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          if (store.count("sys_security_state") >= 4096) {
            throw new BusinessException("验证服务繁忙，请稍后再试");
          }
          store.insertState(hash(token), "PROOF", hash(subject), payload, now + ttl);
        });
  }

  /** 一次性消费与过期清理共用守卫；独立事务提交后才返回内容，后续业务失败不返还凭证。 */
  @Override
  public String take(String kind, String token) {
    if (token == null || token.length() > 128) {
      return null;
    }
    return transaction.execute(
        status -> {
          long now = lock();
          String payload =
              store.lockPayload(hash(token), kind, now).stream()
                  .map(row -> row.getString("payload"))
                  .findFirst()
                  .orElse(null);
          store.deleteConsumed(hash(token), kind);
          return payload;
        });
  }

  @Override
  public boolean allowed(String source, String account) {
    return transaction.execute(
        status -> {
          lock();
          return store.count("sys_security_rate") < 10000
              && store.attempts(hash("login-source:" + source)) < 100
              && store.attempts(hash("login-account:" + account)) < 5;
        });
  }

  @Override
  public void failed(String source, String account) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          store.increment(hash("login-source:" + source), now + 900000);
          store.increment(hash("login-account:" + account), now + 900000);
        });
  }

  private int counter(String key) {
    return store.attempts(key);
  }

  private void increment(String key, long expiry) {
    store.increment(key, expiry);
  }

  /** 成功清理也先持有守卫，避免失败窗口的主键删除与到期索引清理形成反向锁序。 */
  @Override
  public void succeeded(String account) {
    transaction.executeWithoutResult(
        status -> {
          lock();
          store.clearAttempts(hash("login-account:" + account));
        });
  }

  /** 公开匿名入口复用共享固定窗口；命名空间由业务常量提供，不接受客户端指定限额或时长。 */
  public void reserve(String purpose, String subject, int limit, long durationMillis) {
    transaction.executeWithoutResult(
        status -> {
          long now = lock();
          String key = hash(purpose + ":" + subject);
          if (counter(key) >= limit) {
            throw new BusinessException("操作过于频繁，请稍后重试");
          }
          if (store.count("sys_security_rate") >= 10000 && counter(key) == 0) {
            throw new BusinessException("服务繁忙，请稍后再试");
          }
          increment(key, now + durationMillis);
        });
  }
}
