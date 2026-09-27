package com.mayday.system.repository;

import com.mayday.system.model.SysRole;
import java.util.Optional;
import org.springframework.data.jpa.repository.*;

/** 角色编码在数据库层唯一，防止重复角色造成授权歧义。 */
public interface RoleRepository
    extends JpaRepository<SysRole, Long>, JpaSpecificationExecutor<SysRole> {
  Optional<SysRole> findByCode(String code);

  boolean existsByScopeDepartments_DepartmentId(Long departmentId);
}
