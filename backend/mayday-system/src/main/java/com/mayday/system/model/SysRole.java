package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.util.*;
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

  @Column(nullable = false)
  private boolean enabled = true;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_permission", joinColumns = @JoinColumn(name = "role_id"))
  @Column(name = "permission", length = 100)
  private Set<String> permissions = new HashSet<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_scope", joinColumns = @JoinColumn(name = "role_id"))
  @MapKeyColumn(name = "resource", length = 64)
  @Column(name = "data_scope", length = 32)
  private Map<String, String> dataScopes = new HashMap<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_role_scope_department", joinColumns = @JoinColumn(name = "role_id"))
  private Set<DepartmentGrant> scopeDepartments = new HashSet<>();
}
