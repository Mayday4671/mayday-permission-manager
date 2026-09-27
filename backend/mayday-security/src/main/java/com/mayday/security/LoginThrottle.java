package com.mayday.security;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** 单实例登录限流：按来源地址固定窗口计数；多实例部署可将此组件替换为 Redis 原子计数器。 */
@Component
public class LoginThrottle {
  private record Attempt(int count, long until) {}

  private final ConcurrentHashMap<String, Attempt> attempts = new ConcurrentHashMap<>();

  private void prune() {
    long now = Instant.now().getEpochSecond();
    attempts.entrySet().removeIf(e -> e.getValue().until() < now);
  }

  private String account(String ip, String username) {
    return "account:" + ip + ":" + username.toLowerCase(java.util.Locale.ROOT);
  }

  public synchronized boolean allowed(String ip, String username) {
    prune();
    Attempt source = attempts.get("ip:" + ip), user = attempts.get(account(ip, username));
    return attempts.size() < 10000
        && (source == null || source.count() < 100)
        && (user == null || user.count() < 5);
  }

  /** 只统计失败尝试，正常登录不会耗尽整个团队共享出口的配额。 */
  public synchronized void failed(String ip, String username) {
    prune();
    for (String key : java.util.List.of("ip:" + ip, account(ip, username))) {
      Attempt old = attempts.get(key);
      attempts.put(
          key,
          new Attempt(
              old == null ? 1 : old.count() + 1,
              old == null ? Instant.now().getEpochSecond() + 900 : old.until()));
    }
  }

  public synchronized void succeeded(String ip, String username) {
    attempts.remove(account(ip, username));
  }
}
