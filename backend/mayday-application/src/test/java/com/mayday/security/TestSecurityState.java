package com.mayday.security;

import com.mayday.common.BusinessException;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;

/** 仅测试源码中的共享状态替身；生产模块不包含它，真实多实例检查仍必须连接 MySQL。 */
final class TestSecurityState implements SecurityState {
  /** 测试一次性条目；与可推进时钟共同验证先消费和有效期，不属于生产存储。 */
  private record Entry(String kind, String subject, String value, long expiry) {}

  /** 测试固定窗口只保存次数及结束时间，后续失败不延长原窗口。 */
  private record Window(int count, long expiry) {}

  private final Clock clock;
  private final Map<String, Entry> entries = new HashMap<>();
  private final Map<String, Window> rates = new HashMap<>();

  TestSecurityState(Clock clock) {
    this.clock = clock;
  }

  @Override
  public long now() {
    return clock.millis();
  }

  private void prune() {
    entries.values().removeIf(value -> value.expiry() <= now());
    rates.values().removeIf(value -> value.expiry() <= now());
  }

  private void increment(String key, long ttl) {
    var before = rates.get(key);
    rates.put(
        key,
        new Window(
            before == null ? 1 : before.count() + 1,
            before == null ? now() + ttl : before.expiry()));
  }

  @Override
  public synchronized void reserveChallenge(String source) {
    prune();
    var rate = rates.get("captcha:" + source);
    if (rate != null && rate.count() >= 120) throw new BusinessException("验证请求过于频繁，请稍后再试");
    increment("captcha:" + source, 60000);
  }

  @Override
  public synchronized void challenge(
      String token, String subject, String source, String payload, long ttl) {
    prune();
    entries
        .values()
        .removeIf(value -> value.kind().equals("CHALLENGE") && value.subject().equals(subject));
    entries.put(token, new Entry("CHALLENGE", subject, payload, now() + ttl));
  }

  @Override
  public synchronized void proof(String token, String subject, String payload, long ttl) {
    prune();
    entries.put(token, new Entry("PROOF", subject, payload, now() + ttl));
  }

  @Override
  public synchronized String take(String kind, String token) {
    prune();
    var result = entries.remove(token);
    return result != null && result.kind().equals(kind) ? result.value() : null;
  }

  @Override
  public synchronized boolean allowed(String source, String account) {
    prune();
    var ip = rates.get("source:" + source);
    var user = rates.get("account:" + account);
    return (ip == null || ip.count() < 100) && (user == null || user.count() < 5);
  }

  @Override
  public synchronized void failed(String source, String account) {
    prune();
    increment("source:" + source, 900000);
    increment("account:" + account, 900000);
  }

  @Override
  public synchronized void succeeded(String account) {
    rates.remove("account:" + account);
  }
}
