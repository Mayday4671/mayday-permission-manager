package com.mayday.web;

import com.mayday.common.*;
import com.mayday.security.*;
import com.mayday.service.UserService;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import com.mayday.web.Contracts.*;
import jakarta.validation.Valid;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 权限配置与角色维护分权；内置管理员角色锁定，防止误操作破坏整个授权体系。 */
@RestController
@RequestMapping("/api/system/roles")
@RequiredArgsConstructor
public class RoleController {
  private final RoleRepository roles;
  private final UserRepository users;
  private final com.mayday.system.repository.EntryRepository entries;
  private final AccessPolicy access;

  @GetMapping
  @PreAuthorize("@access.has('roles:view')")
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(
        PageResult.from(
            roles.findAll(
                (r, q, c) ->
                    c.or(
                        SearchPredicates.contains(c, r.get("name"), keyword),
                        SearchPredicates.contains(c, r.get("code"), keyword)),
                PageResult.request(page, size))));
  }

  @GetMapping("/permissions")
  @PreAuthorize("@access.has('roles:view')")
  public ApiResponse<?> permissions() {
    return ApiResponse.ok(PermissionCatalog.GROUPS);
  }

  @PostMapping
  @PreAuthorize("@access.has('roles:create') and @access.has('roles:grant')")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody RoleRequest req) {
    return ApiResponse.ok(save(null, req));
  }

  @PutMapping("/{id}")
  @PreAuthorize("@access.has('roles:update') and @access.has('roles:grant')")
  @Transactional
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody RoleRequest req) {
    return ApiResponse.ok(save(id, req));
  }

  private SysRole save(Long id, RoleRequest req) {
    SysRole role =
        id == null
            ? new SysRole()
            : roles.findById(id).orElseThrow(() -> new BusinessException("角色不存在"));
    if ("admin".equals(role.getCode()) || "admin".equals(req.code()))
      throw new BusinessException("内置管理员角色不可修改");
    if (id != null) {
      UserService.version(role, req.version());
      access.checkGrant(List.of(role));
    }
    if (!PermissionCatalog.ALL.containsAll(req.permissions()))
      throw new BusinessException("包含未注册的权限");
    if (req.permissions().contains("userstats:view") && !req.permissions().contains("users:view"))
      throw new BusinessException("用户统计需同时具有用户查看权限，以确定可统计的数据范围");
    req.dataScopes()
        .forEach(
            (resource, scope) -> {
              if (!PermissionCatalog.SCOPED_RESOURCES.contains(resource)
                  || !PermissionCatalog.SCOPES.contains(scope))
                throw new BusinessException("数据范围不合法");
            });
    // 操作权限必须同时具有查看权限，避免不可见却可写入的模糊授权。
    for (String permission : req.permissions())
      if (!req.permissions().contains(permission.split(":")[0] + ":view"))
        throw new BusinessException("授予操作权限时请同时勾选查看");
    for (String field : List.of("email", "phone"))
      if (req.permissions().contains("users:" + field + "-write")
          && !req.permissions().contains("users:" + field + "-read")
          && !req.permissions().contains("users:sensitive"))
        throw new BusinessException("修改联系方式必须同时具有对应字段查看权限");
    Set<DepartmentGrant> grants =
        req.scopeDepartments() == null ? Set.of() : req.scopeDepartments();
    // 拒绝其他资源、空范围及非部门 ID；未选择 CUSTOM 的资源不允许夹带隐藏授权。
    for (DepartmentGrant grant : grants) {
      if (!"CUSTOM".equals(req.dataScopes().get(grant.getResource())))
        throw new BusinessException("指定部门只能用于自定义数据范围");
      entries
          .findById(grant.getDepartmentId())
          .filter(e -> "departments".equals(e.getKind()) && e.isEnabled())
          .orElseThrow(() -> new BusinessException("请选择有效部门"));
    }
    req.dataScopes()
        .forEach(
            (resource, scope) -> {
              if ("CUSTOM".equals(scope)
                  && grants.stream().noneMatch(g -> resource.equals(g.getResource())))
                throw new BusinessException("自定义数据范围至少选择一个部门");
            });
    role.setCode(req.code());
    role.setName(req.name());
    role.setDescription(req.description());
    role.setEnabled(req.enabled());
    role.setPermissions(new HashSet<>(req.permissions()));
    role.setDataScopes(new HashMap<>(req.dataScopes()));
    role.setScopeDepartments(new HashSet<>(grants));
    access.checkGrant(List.of(role));
    return roles.saveAndFlush(role);
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('roles:delete')")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    SysRole role = roles.findById(id).orElseThrow(() -> new BusinessException("角色不存在"));
    if ("admin".equals(role.getCode())) throw new BusinessException("内置管理员角色不可删除");
    access.checkGrant(List.of(role));
    if (users.existsByRoles_Id(id)) throw new BusinessException("角色正在使用，请先解除用户关联");
    roles.delete(role);
    return ApiResponse.ok(null);
  }
}
