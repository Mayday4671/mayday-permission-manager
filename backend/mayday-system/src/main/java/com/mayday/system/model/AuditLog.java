package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
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

  /** 只保存不含查询参数的路径，防止搜索内容或历史系统的 URL 凭证进入审计。 */
  @Column(length = 255)
  private String path;

  /** 记录最终 HTTP 状态，业务拒绝和失败同样保留；不存异常正文。 */
  private int status;

  private long durationMs;

  @Column(length = 64)
  private String ip;
}
