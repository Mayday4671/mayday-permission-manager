package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** 可复用的基础资料模型：部门、菜单、字典、参数共享生命周期，业务约束由服务层按 kind 执行。 */
@Getter
@Setter
@Entity
@Table(name = "sys_entry", uniqueConstraints = @UniqueConstraint(columnNames = {"kind", "code"}))
public class SystemEntry extends BaseEntity {
  /** 资料类型属于服务端白名单，所有按主键操作都必须同时匹配类型，避免跨资源读取。 */
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

  /** 菜单可见性所需动作键；菜单配置只影响导航展示，不替代接口实际授权。 */
  @Column(length = 100)
  private String permission;

  /** 后台已注册的内部路由；保存时由服务端目录校验，不能传入任意外链或脚本。 */
  @Column(length = 160)
  private String path;

  /** 仅树形资源使用的父节点；服务层拒绝跨类型父级、自指向和层级循环。 */
  private Long parentId;

  /** 仅部门使用负责人，组织变动与流程解析后续共同读取此稳定账号 ID。 */
  private Long leaderId;

  @Column(length = 64)
  private String icon;

  @Column(nullable = false, length = 64)
  private String groupName = "通用";

  @Column(nullable = false, length = 16)
  private String valueType = "TEXT";

  /** 内置资料的删除与关键值修改由服务层保护，不能只凭前端隐藏按钮。 */
  @Column(nullable = false)
  private boolean builtIn;

  @Column(nullable = false)
  private int sortOrder;

  @Column(nullable = false)
  private boolean enabled = true;
}
