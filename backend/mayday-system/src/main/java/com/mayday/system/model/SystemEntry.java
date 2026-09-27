package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 可复用的基础资料模型：部门、菜单、字典、参数共享生命周期，业务约束由服务层按 kind 执行。 */
@Getter
@Setter
@Entity
@Table(name = "sys_entry", uniqueConstraints = @UniqueConstraint(columnNames = {"kind", "code"}))
public class SystemEntry extends BaseEntity {
  @Column(nullable = false, length = 32)
  private String kind;

  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false, length = 100)
  private String code;

  @Column(length = 2000)
  private String value;

  @Column(length = 500)
  private String description;

  @Column(length = 100)
  private String permission;

  @Column(length = 160)
  private String path;

  private Long parentId;

  /** 仅部门使用负责人，组织变动与流程解析后续共同读取此稳定账号 ID。 */
  private Long leaderId;

  @Column(length = 64)
  private String icon;

  @Column(nullable = false, length = 64)
  private String groupName = "通用";

  @Column(nullable = false, length = 16)
  private String valueType = "TEXT";

  @Column(nullable = false)
  private boolean builtIn;

  @Column(nullable = false)
  private int sortOrder;

  @Column(nullable = false)
  private boolean enabled = true;
}
