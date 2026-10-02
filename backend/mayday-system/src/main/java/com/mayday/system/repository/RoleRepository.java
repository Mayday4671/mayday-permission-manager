package com.mayday.system.repository;

import com.mayday.system.model.SysRole;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 角色编码在数据库层唯一，防止重复角色造成授权歧义。 */
public interface RoleRepository
    extends JpaRepository<SysRole, Long>, JpaSpecificationExecutor<SysRole> {
  /** 通过稳定编码解析角色，包含停用角色；调用方仍需检查角色状态和授权委托边界。 */
  Optional<SysRole> findByCode(String code);

  /** 部门删除前保护 CUSTOM 范围引用，不能因角色停用就移除其显式授权部门。 */
  boolean existsByScopeDepartments_DepartmentId(Long departmentId);
}
