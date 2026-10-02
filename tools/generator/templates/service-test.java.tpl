package com.mayday.{{module}};

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.{{module}}.{{entity}}Contracts.{{entity}}Request;
import com.mayday.security.AccessPolicy;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;

/** 保护模板的关键安全边界；生成的接口还需在真实 MySQL 中验证行级范围和事务。 */
@ExtendWith(MockitoExtension.class)
class {{entity}}ServiceTest {
  @Mock private {{entity}}Repository repository;
  @Mock private AccessPolicy access;
  private {{entity}}Service service;

  /** 每项安全检查使用独立服务和仓储模拟，避免前一用例的授权结果残留。 */
  @BeforeEach
  void setUp() {
    service = new {{entity}}Service(repository, access);
  }

  /** 动作未授权时必须在访问仓储前失败，不能先查询再隐藏结果。 */
  @Test
  void missingPermissionDoesNotReadRepository() {
    doThrow(new AccessDeniedException("denied")).when(access).require("{{resource}}:view");
    assertThrows(AccessDeniedException.class, () -> service.get(1L));
    verify(repository, never()).findById(anyLong());
  }

  /** 删除与查看采用相同行级范围，不能用已有动作权限越过记录所有权。 */
  @Test
  void outOfScopeRecordCannotBeDeleted() {
    {{entity}} entity = existing();
    when(repository.findById(1L)).thenReturn(Optional.of(entity));
    doThrow(new AccessDeniedException("denied")).when(access).checkData("{{resource}}", 2L, 3L);
    assertThrows(AccessDeniedException.class, () -> service.delete(1L, 4L));
    verify(repository, never()).delete(entity);
  }

  /** 过期版本不能保存或刷新实体，防止覆盖已经提交的新值。 */
  @Test
  void staleVersionCannotBeOverwritten() {
    when(repository.findById(1L)).thenReturn(Optional.of(existing()));
    {{entity}}Request request = new {{entity}}Request({{testValues}}, 3L);
    assertThrows(OptimisticLockingFailureException.class, () -> service.update(1L, request));
    verify(repository, never()).flush();
  }

  private {{entity}} existing() {
    {{entity}} entity = new {{entity}}();
    entity.setId(1L);
    entity.setOwnerId(2L);
    entity.setDepartmentId(3L);
    entity.setVersion(4L);
    return entity;
  }
}
