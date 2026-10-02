package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/** 角色聚合：操作权限与数据范围分开存储。多个角色取授权并集；没有配置范围时按本人处理。 */
@Getter
@Setter
@Entity
@Table(name = "sys_role")
public class SysRole extends BaseEntity {
  @Column(nullable = false, unique = true, length = 64)
  private String code;

  @Column(nullable = false, length = 64)
  private String name;

  @Column(length = 500)
  private String description;

  /** 停用立即排除操作权限与数据范围，保留账号关联便于后续恢复。 */
  @Column(nullable = false)
  private boolean enabled = true;

  /** 只存服务端权限目录已注册的动作键；角色管理和授予动作需要各自的权限。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_permission", joinColumns = @JoinColumn(name = "role_id"))
  @Column(name = "permission", length = 100)
  private Set<String> permissions = new HashSet<>();

  /** 各资源分别配置范围；没有本资源查看动作的角色不能通过该表单独扩展可见数据。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_scope", joinColumns = @JoinColumn(name = "role_id"))
  @MapKeyColumn(name = "resource", length = 64)
  @Column(name = "data_scope", length = 32)
  private Map<String, String> dataScopes = new HashMap<>();

  /** CUSTOM 只授权显式部门，不自动包含本人或部门后代；跨角色按实际部门集合合并。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_scope_department", joinColumns = @JoinColumn(name = "role_id"))
  private Set<DepartmentGrant> scopeDepartments = new HashSet<>();
}
