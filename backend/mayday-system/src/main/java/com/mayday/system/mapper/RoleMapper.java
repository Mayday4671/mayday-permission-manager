package com.mayday.system.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.system.model.DepartmentGrant;
import com.mayday.system.model.SysRole;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.io.Serializable;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.apache.ibatis.annotations.Mapper;

/** 角色仓储。权限、数据范围与 CUSTOM 部门存储在三张关联表：读取入口统一装配明细， 保存主表后由 {@link #syncDetails} 在同一事务全量重建。 */
@Mapper
public interface RoleMapper extends EntityMapper<SysRole> {
  /** 通过稳定编码解析角色，包含停用角色；调用方仍需检查角色状态和授权委托边界。 */
  default Optional<SysRole> findByCode(String code) {
    SysRole role = selectOneByQuery(QueryWrapper.create().where(new QueryColumn("code").eq(code)));
    return role == null ? Optional.empty() : Optional.of(load(role));
  }

  /** 按主键载入并装配授权明细；授予与委托检查必须看到真实集合。 */
  @Override
  default Optional<SysRole> findById(Serializable id) {
    SysRole role = selectOneById(id);
    return role == null ? Optional.empty() : Optional.of(load(role));
  }

  /** 按主键集合载入并装配明细；用户保存前的可委托角色校验依赖完整授权。 */
  @Override
  default List<SysRole> findAllById(Iterable<Long> ids) {
    List<SysRole> roles = EntityMapper.super.findAllById(ids);
    roles.forEach(this::load);
    return roles;
  }

  /** 部门删除前保护 CUSTOM 范围引用，不能因角色停用就移除其显式授权部门。 */
  default boolean existsByScopeDepartments_DepartmentId(Long departmentId) {
    Object count =
        Db.selectObject(
            "select count(*) from sys_role_scope_department where department_id = ?", departmentId);
    return ((Number) count).longValue() > 0;
  }

  /** 装配操作权限、各资源范围与 CUSTOM 部门授权；每次请求基于最新数据库内容。 */
  default SysRole load(SysRole role) {
    Set<String> permissions = new HashSet<>();
    for (Row row :
        Db.selectListBySql(
            "select permission from sys_role_permission where role_id = ?", role.getId())) {
      permissions.add(row.getString("permission"));
    }
    role.setPermissions(permissions);
    Map<String, String> scopes = new HashMap<>();
    for (Row row :
        Db.selectListBySql(
            "select resource, data_scope from sys_role_scope where role_id = ?", role.getId())) {
      scopes.put(row.getString("resource"), row.getString("data_scope"));
    }
    role.setDataScopes(scopes);
    Set<DepartmentGrant> grants = new HashSet<>();
    for (Row row :
        Db.selectListBySql(
            "select resource, department_id from sys_role_scope_department where role_id = ?",
            role.getId())) {
      DepartmentGrant grant = new DepartmentGrant();
      grant.setResource(row.getString("resource"));
      grant.setDepartmentId(row.getLong("department_id"));
      grants.add(grant);
    }
    role.setScopeDepartments(grants);
    return role;
  }

  /** 保存主表后在同一事务全量重建三张关联表；调用方必须已完成主表保存。 */
  default void syncDetails(SysRole role) {
    Db.deleteBySql("delete from sys_role_permission where role_id = ?", role.getId());
    for (String permission : role.getPermissions()) {
      Db.updateBySql(
          "insert into sys_role_permission(role_id, permission) values (?, ?)",
          role.getId(),
          permission);
    }
    Db.deleteBySql("delete from sys_role_scope where role_id = ?", role.getId());
    for (Map.Entry<String, String> scope : role.getDataScopes().entrySet()) {
      Db.updateBySql(
          "insert into sys_role_scope(role_id, resource, data_scope) values (?, ?, ?)",
          role.getId(),
          scope.getKey(),
          scope.getValue());
    }
    Db.deleteBySql("delete from sys_role_scope_department where role_id = ?", role.getId());
    for (DepartmentGrant grant : role.getScopeDepartments()) {
      Db.updateBySql(
          "insert into sys_role_scope_department(role_id, resource, department_id)"
              + " values (?, ?, ?)",
          role.getId(),
          grant.getResource(),
          grant.getDepartmentId());
    }
  }
}
