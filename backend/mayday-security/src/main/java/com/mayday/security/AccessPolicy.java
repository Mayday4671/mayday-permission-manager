package com.mayday.security;

import com.mayday.common.ModuleSwitches;
import com.mayday.system.model.*;
import com.mayday.system.repository.EntryRepository;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * 集中的授权策略。列表在 SQL 层增加范围条件，单条读写复用同一范围，防止通过猜测 ID 越权。 不使用来自前端的用户 ID、部门 ID 或角色缓存判断当前身份；每次请求从有效会话重新载入。
 */
@Component("access")
@RequiredArgsConstructor
public class AccessPolicy {
  private final EntryRepository entries;
  private final ModuleSwitches modules;

  public SysUser current() {
    return (SysUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
  }

  public boolean admin() {
    return current().getRoles().stream()
        .anyMatch(r -> r.isEnabled() && "admin".equals(r.getCode()));
  }

  public Set<String> permissions() {
    if (admin())
      return PermissionCatalog.ALL.stream()
          .filter(modules::permissionEnabled)
          .collect(java.util.stream.Collectors.toUnmodifiableSet());
    Set<String> result = new HashSet<>();
    current().getRoles().stream()
        .filter(SysRole::isEnabled)
        .forEach(r -> result.addAll(r.getPermissions()));
    result.removeIf(
        permission ->
            !PermissionCatalog.ALL.contains(permission) || !modules.permissionEnabled(permission));
    return result;
  }

  public boolean has(String permission) {
    return permissions().contains(permission);
  }

  public void require(String permission) {
    if (!has(permission)) throw new AccessDeniedException("没有此操作的权限");
  }

  public String scope(String resource) {
    if (admin()) return "ALL";
    // 该值只用于界面摘要与 ALL 判断。实际授权必须使用下面按记录计算的并集。
    return current().getRoles().stream()
        .filter(SysRole::isEnabled)
        .filter(r -> r.getPermissions().contains(resource + ":view"))
        .map(r -> r.getDataScopes().getOrDefault(resource, "SELF"))
        .max(Comparator.comparingInt(PermissionCatalog.SCOPES::indexOf))
        .orElse("SELF");
  }

  private record EffectiveScope(boolean all, boolean self, Set<Long> departments) {}

  /**
   * 按资源合并每个有效角色的授权集合。CUSTOM 不是“大于部门”的等级，不能用大小比较替代。 只有拥有本资源查看权限的角色才参与；CUSTOM 只包含明确选择的部门，不自动带上本人。
   * 原有部门范围继续包含本人，保持已有角色语义。指定部门不隐含其下级。
   */
  private EffectiveScope effectiveScope(String resource) {
    return effectiveScope(current(), resource);
  }

  private EffectiveScope effectiveScope(SysUser user, String resource) {
    if (!user.isEnabled()) return new EffectiveScope(false, false, Set.of());
    if (user.getRoles().stream().anyMatch(r -> r.isEnabled() && "admin".equals(r.getCode())))
      return new EffectiveScope(true, true, Set.of());
    boolean self = false;
    Set<Long> departmentIds = new HashSet<>();
    for (SysRole role : user.getRoles()) {
      if (!role.isEnabled() || !role.getPermissions().contains(resource + ":view")) continue;
      switch (role.getDataScopes().getOrDefault(resource, "SELF")) {
        case "ALL":
          return new EffectiveScope(true, true, Set.of());
        case "SELF":
          self = true;
          break;
        case "DEPARTMENT", "DEPARTMENT_TREE":
          self = true;
          departmentIds.addAll(
              departments(role.getDataScopes().get(resource), user.getDepartmentId()));
          break;
        case "CUSTOM":
          role.getScopeDepartments().stream()
              .filter(g -> resource.equals(g.getResource()))
              .map(DepartmentGrant::getDepartmentId)
              .forEach(departmentIds::add);
          break;
        default:
          break; // 未知旧值不扩权。
      }
    }
    return new EffectiveScope(false, self, departmentIds);
  }

  public Set<Long> departments(String scope) {
    return departments(scope, current().getDepartmentId());
  }

  private Set<Long> departments(String scope, Long departmentId) {
    Set<Long> ids = new HashSet<>();
    if (departmentId == null) return ids;
    ids.add(departmentId);
    if ("DEPARTMENT_TREE".equals(scope)) {
      List<SystemEntry> all = entries.findByKindOrderBySortOrderAscIdAsc("departments");
      boolean changed;
      do {
        changed = false;
        for (SystemEntry e : all) if (ids.contains(e.getParentId())) changed |= ids.add(e.getId());
      } while (changed);
    }
    return ids;
  }

  public boolean contains(String resource, Long ownerId, Long departmentId) {
    return containsFor(current(), resource, ownerId, departmentId);
  }

  /**
   * 跨模块展示账号身份时也必须遵守用户查看权限与数据范围，不能把流程设计权、会话查看权当成全局通讯录权限。 仅校验可见性；修改账号、撤销他人会话等管理动作还需独立检查动作权限及角色管理边界。
   */
  public boolean canViewUser(SysUser user) {
    return has("users:view") && contains("users", user.getId(), user.getDepartmentId());
  }

  /** 后台排期和审批处理复用同一规则，不伪造浏览器会话，也不长期缓存创建时的授权结果。 */
  public boolean hasFor(SysUser user, String permission) {
    return PermissionCatalog.ALL.contains(permission)
        && modules.permissionEnabled(permission)
        && user.isEnabled()
        && user.getRoles().stream()
            .anyMatch(
                r ->
                    r.isEnabled()
                        && ("admin".equals(r.getCode())
                            || r.getPermissions().contains(permission)));
  }

  public boolean containsFor(SysUser user, String resource, Long ownerId, Long departmentId) {
    EffectiveScope scope = effectiveScope(user, resource);
    return scope.all()
        || (scope.self() && Objects.equals(user.getId(), ownerId))
        || (departmentId != null && scope.departments().contains(departmentId));
  }

  public void checkData(String resource, Long ownerId, Long departmentId) {
    if (!contains(resource, ownerId, departmentId)) throw new AccessDeniedException("该数据不在您的授权范围内");
  }

  public <T> Specification<T> filter(String resource, String ownerField) {
    return (root, query, cb) -> {
      EffectiveScope scope = effectiveScope(resource);
      if (scope.all()) return cb.conjunction();
      var predicates = new ArrayList<jakarta.persistence.criteria.Predicate>();
      if (scope.self()) predicates.add(cb.equal(root.get(ownerField), current().getId()));
      if (!scope.departments().isEmpty())
        predicates.add(root.get("departmentId").in(scope.departments()));
      return cb.or(predicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
    };
  }

  /** 只能委托自己已拥有的权限和数据范围。角色管理权不等于授予超级管理员的权力。 */
  public void checkGrant(Collection<SysRole> roles) {
    for (SysRole role : roles) {
      if (admin()) continue;
      if ("admin".equals(role.getCode()) || !permissions().containsAll(role.getPermissions()))
        throw new AccessDeniedException("不能管理或授予超出自身权限的角色");
      role.getDataScopes()
          .forEach(
              (resource, scope) -> {
                // 部门范围依赖受让人所在部门，因此非管理员只能委托本人范围；否则可能跨部门扩大可见数据。
                if (!"SELF".equals(scope)) throw new AccessDeniedException("跨人员的数据范围授权仅允许超级管理员操作");
              });
    }
  }
}
