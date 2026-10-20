package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 只记录操作元数据，不记录请求正文和凭证，兼顾审计与敏感信息保护。 */
@Getter
@Setter
@Table(
    value = "sys_audit_log",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class AuditLog extends BaseEntity {
  private String username;

  private String method;

  /** 只保存不含查询参数的路径，防止搜索内容或历史系统的 URL 凭证进入审计。 */
  private String path;

  /** 记录最终 HTTP 状态，业务拒绝和失败同样保留；不存异常正文。 */
  private int status;

  private long durationMs;

  private String ip;
}
