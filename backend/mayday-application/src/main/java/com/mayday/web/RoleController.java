package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.ModuleSwitches;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.security.PermissionCatalog;
import com.mayday.service.UserService;
import com.mayday.system.model.DepartmentGrant;
import com.mayday.system.model.SysRole;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.RoleRequest;
import jakarta.validation.Valid;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 权限配置与角色维护分权；内置管理员角色锁定，防止误操作破坏整个授权体系。 */
@RestController
@RequestMapping("/api/system/roles")
@RequiredArgsConstructor
public class RoleController {
  private final RoleRepository roles;
  private final UserRepository users;
  private final com.mayday.system.repository.EntryRepository entries;
  private final AccessPolicy access;
  private final ModuleSwitches modules;
  private final com.mayday.service.ChangeAuditService changeAudit;

  /** 在 roles:view 权限内分页搜索角色，列表不扩大当前用户实际可授予的权限。 */
  @GetMapping
  @PreAuthorize("@access.has('roles:view')")
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(
        PageResult.from(
            roles.findAll(
                (root, query, criteria) ->
                    criteria.or(
                        SearchPredicates.contains(criteria, root.get("name"), keyword),
                        SearchPredicates.contains(criteria, root.get("code"), keyword)),
                PageResult.request(page, size))));
  }

  /** 返回已注册且部署模块启用的权限分组，供配置界面展示；服务端保存时再次验证授权边界。 */
  @GetMapping("/permissions")
  @PreAuthorize("@access.has('roles:view')")
  public ApiResponse<?> permissions() {
    return ApiResponse.ok(
        PermissionCatalog.GROUPS.stream()
            .filter(group -> modules.permissionEnabled(group.key() + ":view"))
            .toList());
  }

  /** 新增与授予权限必须同时具备，完整校验后在同一事务记录授权变更快照。 */
  @PostMapping
  @PreAuthorize("@access.has('roles:create') and @access.has('roles:grant')")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody RoleRequest request) {
    return ApiResponse.ok(save(null, request));
  }

  /** 检查原角色与新授权均可被操作者管理，验证 version 并保留变更审计。 */
  @PutMapping("/{id}")
  @PreAuthorize("@access.has('roles:update') and @access.has('roles:grant')")
  @Transactional
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody RoleRequest request) {
    return ApiResponse.ok(save(id, request));
  }

  private SysRole save(Long id, RoleRequest request) {
    SysRole role =
        id == null
            ? new SysRole()
            : roles.findById(id).orElseThrow(() -> new BusinessException("角色不存在"));
    Map<String, Object> before = id == null ? Map.of() : auditSnapshot(role);
    if ("admin".equals(role.getCode()) || "admin".equals(request.code()))
      throw new BusinessException("内置管理员角色不可修改");
    if (id != null) {
      UserService.version(role, request.version());
      access.checkGrant(List.of(role));
    }
    if (!PermissionCatalog.ALL.containsAll(request.permissions()))
      throw new BusinessException("包含未注册的权限");
    if (request.permissions().contains("userstats:view")
        && !request.permissions().contains("users:view"))
      throw new BusinessException("用户统计需同时具有用户查看权限，以确定可统计的数据范围");
    request
        .dataScopes()
        .forEach(
            (resource, scope) -> {
              if (!PermissionCatalog.SCOPED_RESOURCES.contains(resource)
                  || !PermissionCatalog.SCOPES.contains(scope))
                throw new BusinessException("数据范围不合法");
            });
    // 操作权限必须同时具有查看权限，避免不可见却可写入的模糊授权。
    for (String permission : request.permissions())
      if (!request.permissions().contains(permission.split(":")[0] + ":view"))
        throw new BusinessException("授予操作权限时请同时勾选查看");
    for (String field : List.of("email", "phone"))
      if (request.permissions().contains("users:" + field + "-write")
          && !request.permissions().contains("users:" + field + "-read")
          && !request.permissions().contains("users:sensitive"))
        throw new BusinessException("修改联系方式必须同时具有对应字段查看权限");
    Set<DepartmentGrant> grants =
        request.scopeDepartments() == null ? Set.of() : request.scopeDepartments();
    // 拒绝其他资源、空范围及非部门 ID；未选择 CUSTOM 的资源不允许夹带隐藏授权。
    for (DepartmentGrant grant : grants) {
      if (!"CUSTOM".equals(request.dataScopes().get(grant.getResource())))
        throw new BusinessException("指定部门只能用于自定义数据范围");
      entries
          .findById(grant.getDepartmentId())
          .filter(entry -> "departments".equals(entry.getKind()) && entry.isEnabled())
          .orElseThrow(() -> new BusinessException("请选择有效部门"));
    }
    request
        .dataScopes()
        .forEach(
            (resource, scope) -> {
              if ("CUSTOM".equals(scope)
                  && grants.stream().noneMatch(grant -> resource.equals(grant.getResource())))
                throw new BusinessException("自定义数据范围至少选择一个部门");
            });
    role.setCode(request.code());
    role.setName(request.name());
    role.setDescription(request.description());
    role.setEnabled(request.enabled());
    role.setPermissions(new HashSet<>(request.permissions()));
    role.setDataScopes(new HashMap<>(request.dataScopes()));
    role.setScopeDepartments(new HashSet<>(grants));
    access.checkGrant(List.of(role));
    roles.saveAndFlush(role);
    changeAudit.record(
        "角色", role.getId(), id == null ? "创建角色" : "调整角色授权", before, auditSnapshot(role));
    return role;
  }

  /** 权限/范围稳定排序，删除账号或角色后仍保留可读的授权变更，审计中不存业务正文。 */
  private static Map<String, Object> auditSnapshot(SysRole role) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("角色编码", role.getCode());
    snapshot.put("角色名称", role.getName());
    snapshot.put("启用", role.isEnabled());
    snapshot.put("操作权限", role.getPermissions().stream().sorted().toList());
    snapshot.put("数据范围", new TreeMap<>(role.getDataScopes()));
    snapshot.put(
        "指定部门",
        role.getScopeDepartments().stream()
            .map(grant -> grant.getResource() + ":" + grant.getDepartmentId())
            .sorted()
            .toList());
    return snapshot;
  }

  /** 拒绝删除内置或正在使用的角色；可授予边界检查通过后在删除事务内保存审计快照。 */
  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('roles:delete')")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    SysRole role = roles.findById(id).orElseThrow(() -> new BusinessException("角色不存在"));
    if ("admin".equals(role.getCode())) throw new BusinessException("内置管理员角色不可删除");
    access.checkGrant(List.of(role));
    if (users.existsByRoles_Id(id)) throw new BusinessException("角色正在使用，请先解除用户关联");
    changeAudit.record("角色", role.getId(), "删除角色", auditSnapshot(role), Map.of());
    roles.delete(role);
    return ApiResponse.ok(null);
  }
}
