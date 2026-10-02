package com.mayday.bulk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.service.UserService;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.UserRequest;
import jakarta.validation.Validation;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 导入独立权限、敏感字段、逐行错误和密码脱敏的回归测试；数据库原子性另由集成验收执行。 */
class UserBulkAdapterTest {
  private final AccessPolicy access = mock(AccessPolicy.class);
  private final UserService userService = mock(UserService.class);
  private final UserRepository users = mock(UserRepository.class);
  private final UserBulkAdapter adapter =
      new UserBulkAdapter(
          access,
          userService,
          users,
          mock(RoleRepository.class),
          mock(EntryRepository.class),
          Validation.buildDefaultValidatorFactory().getValidator());

  private CsvCodec.Document document(String text) {
    return CsvCodec.parse(text.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void previewMasksPasswordsAndReportsEveryInvalidRowWithoutSaving() {
    when(access.scope("users")).thenReturn("ALL");
    when(users.findByUsername("alice")).thenReturn(Optional.empty());
    var result =
        adapter.preview(
            document(
                "username,nickname,password,email,roleIds\n"
                    + "alice,Alice,Password1234,private@example.com,1\n"
                    + "alice,Alice,short,,"));
    assertEquals(2, result.totalRows());
    assertEquals(0, result.validRows());
    assertEquals("已提供", result.rows().getFirst().values().get("password"));
    assertTrue(result.rows().getFirst().errors().contains("没有分配角色的权限"));
    assertTrue(result.rows().getFirst().errors().contains("没有修改邮箱的权限"));
    assertTrue(result.rows().get(1).errors().contains("文件内用户名重复"));
    assertFalse(result.toString().contains("Password1234"));
    verify(userService, never())
        .save(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
  }

  @Test
  void invalidBatchCannotReachAnyAccountWrite() {
    when(access.scope("users")).thenReturn("ALL");
    assertThrows(
        BusinessException.class,
        () ->
            adapter.commit(
                document("username,nickname,password\nvalid,Valid,Password1234\nx,Bad,weak")));
    verify(userService, never())
        .save(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    verify(access).require("users:import");
    verify(access).require("users:create");
  }

  @Test
  void templateOmitsUnauthorizedContactAndRoleFields() {
    assertEquals(
        java.util.List.of("username", "nickname", "password", "enabled", "postIds"),
        adapter.templateHeaders());
  }

  @Test
  void credentialWhitespaceIsPreservedWhileAccountNamesAreNormalized() {
    when(access.scope("users")).thenReturn("ALL");
    adapter.commit(document("username,nickname,password\n alice , Alice , Password1234 "));
    ArgumentCaptor<UserRequest> saved = ArgumentCaptor.forClass(UserRequest.class);
    verify(userService).save(org.mockito.ArgumentMatchers.isNull(), saved.capture());
    assertEquals("alice", saved.getValue().username());
    assertEquals("Alice", saved.getValue().nickname());
    assertEquals(" Password1234 ", saved.getValue().password());
  }
}
