package com.mayday.security;

import com.mayday.system.model.LoginSession;
import java.time.Clock;
import java.time.Instant;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

/**
 * 服务端会话策略：固定期限、无请求期限和每账号并发上限在启动时配置。 无请求期限按真实认证请求计算，后台轮询也属于请求活动，不等同于用户键鼠空闲时间。
 * 调小期限会约束已有会话，调大期限不会延长数据库中已签发的固定到期时间。
 */
@Component
@ConfigurationProperties(prefix = "mayday.security.sessions")
public class SessionPolicy implements InitializingBean {
  private int absoluteMinutes = 720;
  private int idleMinutes = 30;
  private int maxPerUser = 5;

  /** 固定登录期限，单位分钟；不会因为持续请求而续期。 */
  public int getAbsoluteMinutes() {
    return absoluteMinutes;
  }

  /** 绑定启动配置；参数范围与跨字段约束统一在绑定完成后检查。 */
  public void setAbsoluteMinutes(int value) {
    absoluteMinutes = value;
  }

  /** 无认证请求的最大间隔，单位分钟；失效判断在服务端完成。 */
  public int getIdleMinutes() {
    return idleMinutes;
  }

  /** 绑定无请求期限，不能以零或负数关闭服务端超时保护。 */
  public void setIdleMinutes(int value) {
    idleMinutes = value;
  }

  /** 每账号有效登录上限，超出时撤销最早登录，最新登录正常签发。 */
  public int getMaxPerUser() {
    return maxPerUser;
  }

  /** 绑定并发上限；不提供无限会话配置，避免账号及在线列表无限增长。 */
  public void setMaxPerUser(int value) {
    maxPerUser = value;
  }

  /** 错误配置直接拒绝启动，不静默退回更宽松的安全规则。 */
  @Override
  public void afterPropertiesSet() {
    if (absoluteMinutes < 5
        || absoluteMinutes > 10080
        || idleMinutes < 1
        || idleMinutes > absoluteMinutes
        || maxPerUser < 1
        || maxPerUser > 20)
      throw new IllegalArgumentException("会话配置无效：固定期限5–10080分钟，无请求期限1–固定期限，并发上限1–20");
  }

  /** 认证、签发和列表共用可测试的 UTC 时钟，不依赖部署机器的显示时区。 */
  @Bean
  Clock sessionClock() {
    return Clock.systemUTC();
  }

  /** 缺少可信签发/活动时间的旧记录拒绝认证，不用当前时间将未知记录重新激活。 */
  public boolean active(LoginSession session, Instant now) {
    Instant expiry = effectiveExpiry(session);
    return expiry != null && expiry.isAfter(now);
  }

  /** 统一认证与列表的失效时间；返回三种期限的最早值，null 表示记录无法安全恢复。 */
  public Instant effectiveExpiry(LoginSession session) {
    if (session.getCreatedAt() == null || session.getExpiresAt() == null) return null;
    Instant activity =
        session.getLastActiveAt() == null ? session.getCreatedAt() : session.getLastActiveAt();
    Instant absolute = session.getCreatedAt().plusSeconds(absoluteMinutes * 60L);
    Instant idle = activity.plusSeconds(idleMinutes * 60L);
    Instant expiry = session.getExpiresAt().isBefore(absolute) ? session.getExpiresAt() : absolute;
    return idle.isBefore(expiry) ? idle : expiry;
  }
}
