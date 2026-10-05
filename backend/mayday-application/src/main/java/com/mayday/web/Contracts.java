package com.mayday.web;

import com.mayday.system.model.DepartmentGrant;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 明确的请求/响应模型，杜绝直接绑定实体导致的批量赋值越权。所有编辑请求携带原始 version。 */
public final class Contracts {
  private Contracts() {}

  /** 登录输入包含一次性滑块凭证；密码只参与校验，不能进入响应、持久化明文或审计正文。 */
  public record LoginRequest(
      @NotBlank @Size(max = 64) String username,
      @NotBlank @Size(max = 72) String password,
      @NotBlank(message = "请先完成滑动验证") @Size(max = 64) String captchaToken) {}

  /** MFA 账号首因素通过只返回短期挑战；验证完成才返回会话，客户端不能把挑战当作 Bearer。 */
  public record LoginView(String token, boolean mfaRequired, String challengeId) {
    public LoginView(String token) {
      this(token, false, null);
    }
  }

  /** 数据范围的封闭枚举；多个角色合并后的实际范围由服务端 AccessPolicy 计算。 */
  public enum DataScope {
    SELF,
    DEPARTMENT,
    DEPARTMENT_TREE,
    CUSTOM,
    ALL
  }

  /** 会话响应采用明确 DTO，客户端类型与当前服务端字段保持一致。 */
  @io.swagger.v3.oas.annotations.media.Schema(requiredProperties = {"admin"})
  public record SessionView(
      @NotNull UserView user,
      @NotNull Set<String> permissions,
      @NotNull Map<String, DataScope> dataScopes,
      boolean admin) {}

  /** 用户自行改密需验证原密码；成功后撤销该用户全部会话，阻止旧令牌继续使用。 */
  public record PasswordRequest(
      @NotBlank @Size(max = 72) String oldPassword,
      @NotBlank @Size(min = 10, max = 64) String newPassword,
      @Size(max = 64) String factor) {
    public PasswordRequest(String oldPassword, String newPassword) {
      this(oldPassword, newPassword, null);
    }
  }

  /** 管理员重置密码输入；目标用户范围和独立 users:reset 权限由服务端另行检查。 */
  public record ResetPasswordRequest(@NotBlank @Size(min = 10, max = 64) String password) {}

  /** 批量操作的目标及其列表版本，用于拒绝选择后已被其他管理员修改的记录。 */
  public record TargetVersion(@NotNull Long id, @NotNull Long version) {}

  /** 最多一次变更 100 个账号状态；服务层逐项验证数据范围、管理员保护和并发版本。 */
  public record UserStatusRequest(
      @NotNull @Size(min = 1, max = 100)
          List<@NotNull @jakarta.validation.Valid TargetVersion> rows,
      boolean enabled) {}

  /** 本人可编辑的资料白名单，不接受账号名、角色、部门、岗位或启用状态。 */
  public record ProfileRequest(
      @NotBlank @Size(max = 64) String nickname,
      @Email @Size(max = 128) String email,
      @Size(max = 32) String phone) {}

  /**
   * 用户新增或编辑输入。password 仅用于创建初始凭据，编辑改密使用独立重置协议； 联系方式写权限、角色分配、部门归属、数据范围及 version 均须由 UserService 再校验。
   */
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

  /** 用户列表与会话的安全视图，不含密码散列；未经字段授权的联系方式以 null 返回。 */
  @io.swagger.v3.oas.annotations.media.Schema(
      requiredProperties = {
        "id",
        "username",
        "nickname",
        "email",
        "phone",
        "departmentId",
        "departmentName",
        "enabled",
        "roleIds",
        "roleNames",
        "postIds",
        "createdAt",
        "version"
      })
  public record UserView(
      Long id,
      String username,
      String nickname,
      @io.swagger.v3.oas.annotations.media.Schema(nullable = true) String email,
      @io.swagger.v3.oas.annotations.media.Schema(nullable = true) String phone,
      @io.swagger.v3.oas.annotations.media.Schema(nullable = true) Long departmentId,
      String departmentName,
      boolean enabled,
      Set<Long> roleIds,
      List<String> roleNames,
      Set<Long> postIds,
      LocalDateTime createdAt,
      Long version) {
    /** 按已计算的字段权限投影实体；角色只输出标识和名称，绝不序列化授权实体关系。 */
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

  /** 角色授权输入：操作权限只能来自注册目录，自定义范围必须对应有效部门。 授权不得超过当前操作者可授予的权限和范围；更新必须携带读取时的 version。 */
  public record RoleRequest(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_]{2,64}") String code,
      @NotBlank @Size(max = 64) String name,
      @Size(max = 500) String description,
      boolean enabled,
      @NotNull Set<String> permissions,
      @NotNull Map<String, String> dataScopes,
      Set<@NotNull @jakarta.validation.Valid DepartmentGrant> scopeDepartments,
      Long version) {}

  /** 部门、菜单、岗位、分类等字典资源的共用输入。kind 由受控路由确定，不能由请求切换； 父子关系、负责人、参数值类型、路径及权限标识由具体资源服务验证。 */
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

  /** 旧内容编辑协议；保留显式发布状态以兼容旧客户端，新编辑器使用独立修订与发布协议。 */
  public record NoticeRequest(
      @NotBlank @Size(max = 160) String title,
      @NotBlank @Size(max = 32) String category,
      @Size(max = 500) String summary,
      @NotBlank @Size(max = 50000) String content,
      @Size(max = 10) Set<@NotBlank @Size(max = 32) String> tags,
      boolean published,
      Long version) {}
}
