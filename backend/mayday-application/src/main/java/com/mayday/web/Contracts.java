package com.mayday.web;

import com.mayday.system.model.*;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.*;

/** 明确的请求/响应模型，杜绝直接绑定实体导致的批量赋值越权。所有编辑请求携带原始 version。 */
public final class Contracts {
  private Contracts() {}

  public record LoginRequest(
      @NotBlank @Size(max = 64) String username,
      @NotBlank @Size(max = 72) String password,
      @NotBlank(message = "请先完成滑动验证") @Size(max = 64) String captchaToken) {}

  public record PasswordRequest(
      @NotBlank @Size(max = 72) String oldPassword,
      @NotBlank @Size(min = 10, max = 64) String newPassword) {}

  public record ResetPasswordRequest(@NotBlank @Size(min = 10, max = 64) String password) {}

  public record TargetVersion(@NotNull Long id, @NotNull Long version) {}

  public record UserStatusRequest(
      @NotNull @Size(min = 1, max = 100)
          List<@NotNull @jakarta.validation.Valid TargetVersion> rows,
      boolean enabled) {}

  public record ProfileRequest(
      @NotBlank @Size(max = 64) String nickname,
      @Email @Size(max = 128) String email,
      @Size(max = 32) String phone) {}

  public record UserRequest(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_]{3,32}") String username,
      @NotBlank @Size(max = 64) String nickname,
      @Email @Size(max = 128) String email,
      @Size(max = 32) String phone,
      @Size(max = 64) String password,
      Long departmentId,
      boolean enabled,
      @NotNull Set<Long> roleIds,
      Set<Long> postIds,
      Long version) {}

  public record UserView(
      Long id,
      String username,
      String nickname,
      String email,
      String phone,
      Long departmentId,
      String departmentName,
      boolean enabled,
      Set<Long> roleIds,
      List<String> roleNames,
      Set<Long> postIds,
      LocalDateTime createdAt,
      Long version) {
    public static UserView from(
        SysUser user, String departmentName, boolean emailReadable, boolean phoneReadable) {
      return new UserView(
          user.getId(),
          user.getUsername(),
          user.getNickname(),
          emailReadable ? user.getEmail() : null,
          phoneReadable ? user.getPhone() : null,
          user.getDepartmentId(),
          departmentName,
          user.isEnabled(),
          user.getRoles().stream().map(SysRole::getId).collect(java.util.stream.Collectors.toSet()),
          user.getRoles().stream().map(SysRole::getName).sorted().toList(),
          user.getPostIds(),
          user.getCreatedAt(),
          user.getVersion());
    }
  }

  public record RoleRequest(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_]{2,64}") String code,
      @NotBlank @Size(max = 64) String name,
      @Size(max = 500) String description,
      boolean enabled,
      @NotNull Set<String> permissions,
      @NotNull Map<String, String> dataScopes,
      Set<@NotNull @jakarta.validation.Valid DepartmentGrant> scopeDepartments,
      Long version) {}

  public record EntryRequest(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_.:-]{1,100}") String code,
      @Size(max = 2000) String value,
      @Size(max = 500) String description,
      @Size(max = 100) String permission,
      @Size(max = 160) String path,
      Long parentId,
      Long leaderId,
      @Size(max = 64) String icon,
      @Size(max = 64) String groupName,
      @Pattern(regexp = "TEXT|NUMBER|BOOLEAN|JSON|EMAIL") String valueType,
      @Min(0) @Max(9999) int sortOrder,
      boolean enabled,
      Long version) {}

  public record NoticeRequest(
      @NotBlank @Size(max = 160) String title,
      @NotBlank @Size(max = 32) String category,
      @Size(max = 500) String summary,
      @NotBlank @Size(max = 50000) String content,
      @Size(max = 10) Set<@NotBlank @Size(max = 32) String> tags,
      boolean published,
      Long version) {}
}
