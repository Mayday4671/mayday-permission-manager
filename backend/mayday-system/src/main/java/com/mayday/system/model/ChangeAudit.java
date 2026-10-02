package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 与业务事务共同提交的关键变更轨迹；仅保存调用方白名单字段，不存请求正文或凭据。 */
@Entity
@Table(name = "sys_change_audit")
@Getter
@Setter
public class ChangeAudit extends BaseEntity {
  @Column(nullable = false, length = 64)
  private String actor;

  @Column(nullable = false, length = 64)
  private String resource;

  private Long resourceId;

  @Column(nullable = false, length = 100)
  private String action;

  /** 保存服务层白名单字段的前后差异 JSON；密码、会话凭证及正文不参与差异计算。 */
  @Column(nullable = false, columnDefinition = "text")
  private String changesJson;
}
