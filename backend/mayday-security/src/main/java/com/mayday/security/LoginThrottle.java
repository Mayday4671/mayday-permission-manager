package com.mayday.security;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** 单实例登录限流：按来源地址固定窗口计数；多实例部署可将此组件替换为 Redis 原子计数器。 */
@Component
public class LoginThrottle {
  /** 固定窗口中的失败次数与到期秒数；到期后整体删除，后续失败开启新窗口。 */
  private record Attempt(int count, long until) {}

  private final ConcurrentHashMap<String, Attempt> attempts = new ConcurrentHashMap<>();

  private void prune() {
    long now = Instant.now().getEpochSecond();
    attempts.entrySet().removeIf(entry -> entry.getValue().until() < now);
  }

  private String account(String ip, String username) {
    return "account:" + ip + ":" + username.toLowerCase(Locale.ROOT);
  }

  /** 每次登录前同时检查来源和账号窗口；容量达到上限时拒绝继续分配，防止随机账号耗尽内存。 */
  public synchronized boolean allowed(String ip, String username) {
    prune();
    Attempt sourceAttempt = attempts.get("ip:" + ip),
        accountAttempt = attempts.get(account(ip, username));
    return attempts.size() < 10000
        && (sourceAttempt == null || sourceAttempt.count() < 100)
        && (accountAttempt == null || accountAttempt.count() < 5);
  }

  /** 只统计失败尝试，正常登录不会耗尽整个团队共享出口的配额。 */
  public synchronized void failed(String ip, String username) {
    prune();
    for (String key : List.of("ip:" + ip, account(ip, username))) {
      Attempt previousAttempt = attempts.get(key);
      attempts.put(
          key,
          new Attempt(
              previousAttempt == null ? 1 : previousAttempt.count() + 1,
              previousAttempt == null
                  ? Instant.now().getEpochSecond() + 900
                  : previousAttempt.until()));
    }
  }

  /** 成功登录仅清除该来源下的账号失败窗口，保留来源总失败计数，防止成功账号掩护批量猜测。 */
  public synchronized void succeeded(String ip, String username) {
    attempts.remove(account(ip, username));
  }
}
