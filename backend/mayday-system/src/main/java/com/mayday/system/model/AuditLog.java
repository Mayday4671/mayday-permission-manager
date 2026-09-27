package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 只记录操作元数据，不记录请求正文和凭证，兼顾审计与敏感信息保护。 */
@Getter
@Setter
@Entity
@Table(name = "sys_audit_log")
public class AuditLog extends BaseEntity {
  @Column(length = 64)
  private String username;

  @Column(length = 12)
  private String method;

  @Column(length = 255)
  private String path;

  private int status;
  private long durationMs;

  @Column(length = 64)
  private String ip;
}
