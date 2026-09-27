package com.mayday.system.repository;

import com.mayday.system.model.SysUser;
import java.util.Optional;
import org.springframework.data.jpa.repository.*;

/** 用户查询与带数据范围的分页查询共用 Spring Data Specification。 */
public interface UserRepository
    extends JpaRepository<SysUser, Long>, JpaSpecificationExecutor<SysUser> {
  Optional<SysUser> findByUsername(String username);

  /** 为按账号统计的配额提供串行化边界；只在短事务内持有，不能跨网络请求。 */
  @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @Query("select u from SysUser u where u.id = :id")
  Optional<SysUser> lockById(@org.springframework.data.repository.query.Param("id") Long id);

  boolean existsByRoles_Id(Long roleId);

  boolean existsByDepartmentId(Long departmentId);

  long countByEnabled(boolean enabled);
}
