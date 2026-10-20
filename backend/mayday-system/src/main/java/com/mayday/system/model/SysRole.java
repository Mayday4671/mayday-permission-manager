package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/**
 * 角色聚合：操作权限与数据范围分开存储。多个角色取授权并集；没有配置范围时按本人处理。
 *
 * <p>权限、范围与 CUSTOM 部门是三张关联表，实体上标记为非列；仓储读取时装配、保存时全量重建， 授权判断每次请求都以装配后的集合为准。
 */
@Getter
@Setter
@Table(
    value = "sys_role",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class SysRole extends BaseEntity {
  private String code;

  private String name;

  private String description;

  /** 停用立即排除操作权限与数据范围，保留账号关联便于后续恢复。 */
  private boolean enabled = true;

  /** 只存服务端权限目录已注册的动作键；角色管理和授予动作需要各自的权限。 */
  @Column(ignore = true)
  private Set<String> permissions = new HashSet<>();

  /** 各资源分别配置范围；没有本资源查看动作的角色不能通过该表单独扩展可见数据。 */
  @Column(ignore = true)
  private Map<String, String> dataScopes = new HashMap<>();

  /** CUSTOM 只授权显式部门，不自动包含本人或部门后代；跨角色按实际部门集合合并。 */
  @Column(ignore = true)
  private Set<DepartmentGrant> scopeDepartments = new HashSet<>();
}
