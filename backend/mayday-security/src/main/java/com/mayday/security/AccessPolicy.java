package com.mayday.security;

import com.mayday.common.ModuleSwitches;
import com.mayday.system.model.DepartmentGrant;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
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

  /** 取得过滤器本次载入的数据库账号；只能在已经认证的请求或显式建立身份上下文之后调用。 */
  public SysUser current() {
    return (SysUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
  }

  /** 超级管理员由有效角色编码确定，停用角色不产生管理能力；模块开关仍在后续授权时生效。 */
  public boolean admin() {
    return current().getRoles().stream()
        .anyMatch(role -> role.isEnabled() && "admin".equals(role.getCode()));
  }

  /** 合并当前有效角色权限，并排除未知权限和关闭模块，确保旧数据库授权不能绕过服务端注册目录。 */
  public Set<String> permissions() {
    if (admin())
      return PermissionCatalog.ALL.stream()
          .filter(modules::permissionEnabled)
          .collect(Collectors.toUnmodifiableSet());
    Set<String> result = new HashSet<>();
    current().getRoles().stream()
        .filter(SysRole::isEnabled)
        .forEach(role -> result.addAll(role.getPermissions()));
    result.removeIf(
        permission ->
            !PermissionCatalog.ALL.contains(permission) || !modules.permissionEnabled(permission));
    return result;
  }

  /** 检查本次身份的动作权限；不包含记录所有权，读取或修改具体记录还要检查数据范围。 */
  public boolean has(String permission) {
    return permissions().contains(permission);
  }

  /** 动作权限不足时立即返回拒绝访问；业务服务可用于保护不经过控制器的方法调用。 */
  public void require(String permission) {
    if (!has(permission)) throw new AccessDeniedException("没有此操作的权限");
  }

  /** 返回供界面摘要使用的范围名称；CUSTOM 与其他范围的并集不能靠该名称直接判定记录可见性。 */
  public String scope(String resource) {
    if (admin()) return "ALL";
    // 该值只用于界面摘要与 ALL 判断。实际授权必须使用下面按记录计算的并集。
    return current().getRoles().stream()
        .filter(SysRole::isEnabled)
        .filter(role -> role.getPermissions().contains(resource + ":view"))
        .map(role -> role.getDataScopes().getOrDefault(resource, "SELF"))
        .max(Comparator.comparingInt(PermissionCatalog.SCOPES::indexOf))
        .orElse("SELF");
  }

  /** 动作权限与有效角色筛选后的实际行级并集；指定部门保持集合语义，不转换成范围等级。 */
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
    if (user.getRoles().stream()
        .anyMatch(role -> role.isEnabled() && "admin".equals(role.getCode())))
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
              .filter(grant -> resource.equals(grant.getResource()))
              .map(DepartmentGrant::getDepartmentId)
              .forEach(departmentIds::add);
          break;
        default:
          break; // 未知旧值不扩权。
      }
    }
    return new EffectiveScope(false, self, departmentIds);
  }

  /** 从当前账号部门展开范围；仅 DEPARTMENT_TREE 递归包含后代，缺失部门时返回空集合。 */
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
        for (SystemEntry entry : all)
          if (ids.contains(entry.getParentId())) changed |= ids.add(entry.getId());
      } while (changed);
    }
    return ids;
  }

  /** 按当前有效角色并集判断所有者或所属部门是否可见；动作权限必须由业务入口单独要求。 */
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
                role ->
                    role.isEnabled()
                        && ("admin".equals(role.getCode())
                            || role.getPermissions().contains(permission)));
  }

  /** 后台任务用指定数据库账号复核范围；停用账号无可见范围，不能复用创建任务时的授权快照。 */
  public boolean containsFor(SysUser user, String resource, Long ownerId, Long departmentId) {
    EffectiveScope scope = effectiveScope(user, resource);
    return scope.all()
        || (scope.self() && Objects.equals(user.getId(), ownerId))
        || (departmentId != null && scope.departments().contains(departmentId));
  }

  /** 在已校验动作权限后拒绝范围外的单条读写，防止猜测主键绕过列表上的 SQL 过滤。 */
  public void checkData(String resource, Long ownerId, Long departmentId) {
    if (!contains(resource, ownerId, departmentId)) throw new AccessDeniedException("该数据不在您的授权范围内");
  }

  /** 把同一行级并集放进 SQL 查询和计数；实体必须具备约定的所有者字段及 departmentId 字段。 */
  public <T> Specification<T> filter(String resource, String ownerField) {
    return (root, query, builder) -> {
      EffectiveScope scope = effectiveScope(resource);
      if (scope.all()) return builder.conjunction();
      var predicates = new ArrayList<Predicate>();
      if (scope.self()) predicates.add(builder.equal(root.get(ownerField), current().getId()));
      if (!scope.departments().isEmpty())
        predicates.add(root.get("departmentId").in(scope.departments()));
      return builder.or(predicates.toArray(Predicate[]::new));
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
