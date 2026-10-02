package com.mayday.system.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/** 数据库仅保存随机令牌的 SHA-256 摘要；固定期限、撤销和账号状态由每次认证复核，列表不返回摘要。 */
@Getter
@Setter
@Entity
@Table(name = "sys_session")
public class LoginSession {
  /** 面向管理页面的独立会话标识，可用于强制下线；它不是可用于认证的令牌。 */
  @Column(length = 36)
  private String sessionId;

  private Instant createdAt;

  /** 认证服务每分钟最多更新一次，反映最近活动；它不延长 expiresAt 的固定到期时间。 */
  private Instant lastActiveAt;

  @Column(length = 64)
  private String ip;

  @Column(length = 255)
  private String device;

  /** 仅用于认证查找的索引，不能进入公开 DTO、变更日志或前端存储。 */
  @Id
  @Column(length = 64)
  private String tokenHash;

  @Column(nullable = false)
  private Long userId;

  @Column(nullable = false)
  private Instant expiresAt;
}
