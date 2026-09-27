package com.mayday.system.model;

import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/** 数据库仅保存随机令牌的 SHA-256 摘要。令牌丢失或用户停用后可立即撤销会话。 */
@Getter
@Setter
@Entity
@Table(name = "sys_session")
public class LoginSession {
  @Column(length = 36)
  private String sessionId;

  private Instant createdAt;
  private Instant lastActiveAt;

  @Column(length = 64)
  private String ip;

  @Column(length = 255)
  private String device;

  @Id
  @Column(length = 64)
  private String tokenHash;

  @Column(nullable = false)
  private Long userId;

  @Column(nullable = false)
  private Instant expiresAt;
}
