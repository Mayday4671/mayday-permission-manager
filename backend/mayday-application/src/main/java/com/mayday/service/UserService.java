package com.mayday.service;

import com.mayday.common.*;
import com.mayday.security.*;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import com.mayday.web.Contracts.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 用户用例服务：查询范围、敏感字段、角色委托、账号保护、密码加密在同一事务边界内完成。 */
@Service
@RequiredArgsConstructor
@Transactional
public class UserService {
  private final UserRepository users;
  private final RoleRepository roles;
  private final EntryRepository entries;
  private final AccessPolicy access;
  private final PasswordEncoder encoder;
  private final TokenService tokens;

  public UserView view(SysUser u) {
    String dept =
        u.getDepartmentId() == null
            ? "未分配"
            : entries.findById(u.getDepartmentId()).map(SystemEntry::getName).orElse("未分配");
    return UserView.from(
        u, dept, contactPermission("email", "read"), contactPermission("phone", "read"));
  }

  @Transactional(readOnly = true)
  public PageResult<UserView> list(
      String keyword, Boolean enabled, Long departmentId, int page, int size) {
    Specification<SysUser> filter = access.filter("users", "id");
    filter =
        filter.and(
            (r, q, c) ->
                c.or(
                    SearchPredicates.contains(c, r.get("username"), keyword),
                    SearchPredicates.contains(c, r.get("nickname"), keyword)));
    if (enabled != null) filter = filter.and((r, q, c) -> c.equal(r.get("enabled"), enabled));
    if (departmentId != null)
      filter = filter.and((r, q, c) -> c.equal(r.get("departmentId"), departmentId));
    return PageResult.from(users.findAll(filter, PageResult.request(page, size)).map(this::view));
  }

  /** 验证访问目标的范围，同时阻止低权限管理员修改高权限账号。 */
  public SysUser manageable(Long id) {
    SysUser u = users.findById(id).orElseThrow(() -> new BusinessException("用户不存在"));
    access.checkData("users", u.getId(), u.getDepartmentId());
    access.checkGrant(u.getRoles());
    if ("admin".equals(u.getUsername()) && !access.admin())
      throw new AccessDeniedException("不能操作超级管理员");
    return u;
  }

  public UserView save(Long id, UserRequest req) {
    SysUser u = id == null ? new SysUser() : manageable(id);
    if (id != null) version(u, req.version());
    if (id != null && !u.getUsername().equals(req.username()))
      throw new BusinessException("用户名创建后不可修改");
    if (id != null
        && ("admin".equals(u.getUsername()) || id.equals(access.current().getId()))
        && !req.enabled()) throw new BusinessException("不能停用当前账号或初始管理员");
    Set<Long> originalRoles = new HashSet<>();
    u.getRoles().forEach(r -> originalRoles.add(r.getId()));
    if (!originalRoles.equals(req.roleIds())) {
      access.require("users:assign");
      Set<SysRole> assigned = new HashSet<>(roles.findAllById(req.roleIds()));
      if (assigned.size() != req.roleIds().size()
          || assigned.stream().anyMatch(r -> !r.isEnabled()))
        throw new BusinessException("请选择有效角色");
      access.checkGrant(assigned);
      if ("admin".equals(u.getUsername())
          && assigned.stream().noneMatch(r -> "admin".equals(r.getCode())))
        throw new BusinessException("初始管理员必须保留管理员角色");
      if (Objects.equals(id, access.current().getId()))
        throw new BusinessException("请由其他管理员调整您的角色");
      u.setRoles(assigned);
    }
    if (req.departmentId() != null) {
      SystemEntry department =
          entries.findById(req.departmentId()).orElseThrow(() -> new BusinessException("部门不存在"));
      if (!"departments".equals(department.getKind()) || !department.isEnabled())
        throw new BusinessException("请选择有效部门");
    }
    if (!access.admin() && !Objects.equals(u.getDepartmentId(), req.departmentId())) {
      // 调整部门相当于调整部门范围授权，不允许普通用户管理员借此移动高权限资源。
      throw new AccessDeniedException("创建部门账号或调整所属部门需要超级管理员");
    }
    if (id == null) {
      if (!"ALL".equals(access.scope("users"))) throw new AccessDeniedException("当前用户数据范围不允许创建账号");
      validatePassword(req.password());
      u.setPasswordHash(encoder.encode(req.password()));
    }
    u.setUsername(req.username());
    if (req.postIds() != null) {
      var posts = entries.findAllById(req.postIds());
      if (posts.size() != req.postIds().size()
          || posts.stream().anyMatch(p -> !p.getKind().equals("posts") || !p.isEnabled()))
        throw new BusinessException("请选择有效岗位");
      u.setPostIds(new HashSet<>(req.postIds()));
    }
    u.setNickname(req.nickname());
    u.setDepartmentId(req.departmentId());
    u.setEnabled(req.enabled());
    // 无查看权限的旧客户端可能回传 null，保持原值；不允许借普通编辑提交新的受限字段值。
    if (contactPermission("email", "write")) u.setEmail(req.email());
    else if (req.email() != null && !Objects.equals(req.email(), u.getEmail()))
      throw new AccessDeniedException("没有修改邮箱的权限");
    if (contactPermission("phone", "write")) u.setPhone(req.phone());
    else if (req.phone() != null && !Objects.equals(req.phone(), u.getPhone()))
      throw new AccessDeniedException("没有修改电话的权限");
    if (id != null && !req.enabled()) tokens.revokeUser(id);
    return view(users.saveAndFlush(u));
  }

  public void delete(Long id) {
    SysUser u = manageable(id);
    if (entries.existsByLeaderId(id)) throw new BusinessException("此账号是部门负责人，请先调整部门负责人");
    if ("admin".equals(u.getUsername()) || id.equals(access.current().getId()))
      throw new BusinessException("不能删除初始管理员或当前账号");
    tokens.revokeUser(id);
    users.delete(u);
  }

  /** 批量启停只接收 ID/版本/目标状态，不能顺带改角色或联系方式。 所有目标先通过相同的数据范围、授权等级和版本检查，再在一个事务中更新；任一失败整批回滚。 */
  public void changeStatus(UserStatusRequest req) {
    Set<Long> ids = new HashSet<>();
    List<SysUser> selected = new ArrayList<>();
    for (var target : req.rows()) {
      if (!ids.add(target.id())) throw new BusinessException("批量操作含重复账号");
      var user = manageable(target.id());
      version(user, target.version());
      if (!req.enabled()
          && ("admin".equals(user.getUsername()) || target.id().equals(access.current().getId())))
        throw new BusinessException("不能停用当前账号或初始管理员");
      selected.add(user);
    }
    for (var user : selected) {
      user.setEnabled(req.enabled());
      if (!req.enabled()) tokens.revokeUser(user.getId());
    }
    users.saveAllAndFlush(selected);
  }

  public void reset(Long id, String password) {
    SysUser u = manageable(id);
    validatePassword(password);
    u.setPasswordHash(encoder.encode(password));
    tokens.revokeUser(id);
    users.save(u);
  }

  public static void validatePassword(String password) {
    if (password == null
        || password.length() < 10
        || password.length() > 64
        || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72
        || !password.matches(".*[A-Za-z].*")
        || !password.matches(".*[0-9].*")) throw new BusinessException("密码需为 10–64 位，且同时包含字母和数字");
  }

  /** 保留旧版整组联系方式授权的语义，同时允许新角色分别配置各字段读写。 */
  private boolean contactPermission(String field, String operation) {
    return access.has("users:sensitive") || access.has("users:" + field + "-" + operation);
  }

  public static void version(BaseEntity entity, Long version) {
    if (version == null || !Objects.equals(entity.getVersion(), version))
      throw new org.springframework.dao.OptimisticLockingFailureException("版本冲突");
  }
}
