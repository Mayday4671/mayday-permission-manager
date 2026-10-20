package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 与业务事务共同提交的关键变更轨迹；仅保存调用方白名单字段，不存请求正文或凭据。 */
@Getter
@Setter
@Table(
    value = "sys_change_audit",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class ChangeAudit extends BaseEntity {
  private String actor;

  private String resource;

  private Long resourceId;

  private String action;

  /** 保存服务层白名单字段的前后差异 JSON；密码、会话凭证及正文不参与差异计算。 */
  private String changesJson;
}
