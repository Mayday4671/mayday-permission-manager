package com.mayday.system.repository;

import com.mayday.system.model.SysUser;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 用户查询与带数据范围的分页查询共用 Spring Data Specification。 */
public interface UserRepository
    extends JpaRepository<SysUser, Long>, JpaSpecificationExecutor<SysUser> {
  /** 登录按唯一用户名载入账号；不区分账号不存在、停用或密码错误向匿名用户暴露身份信息。 */
  Optional<SysUser> findByUsername(String username);

  /** 为按账号统计的配额提供串行化边界；只在短事务内持有，不能跨网络请求。 */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select u from SysUser u where u.id = :id")
  Optional<SysUser> lockById(@Param("id") Long id);

  /** 角色删除前检查实际账号引用，停用账号仍保留关联并阻止破坏性删除。 */
  boolean existsByRoles_Id(Long roleId);

  /** 部门删除前检查归属账号，避免账号范围和负责人审批使用已删除部门。 */
  boolean existsByDepartmentId(Long departmentId);

  /** 按状态统计账号数量，查看全局统计前由调用方验证相应管理权限。 */
  long countByEnabled(boolean enabled);
}
