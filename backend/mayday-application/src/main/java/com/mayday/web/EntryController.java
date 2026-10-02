package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.service.NavigationCatalog;
import com.mayday.service.SettingService;
import com.mayday.service.UserService;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.DictionaryItemRepository;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.EntryRequest;
import jakarta.validation.Valid;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
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

/** 共用基础资料接口；kind 白名单 + 独立权限前缀，不能通过替换 URL 绕过资源边界。 */
@RestController
@RequestMapping("/api/system/entries")
@RequiredArgsConstructor
public class EntryController {
  private static final Set<String> KINDS =
      Set.of(
          "departments",
          "menus",
          "dictionaries",
          "settings",
          "posts",
          "categories",
          "tags",
          "approvalcategories");
  private final EntryRepository entries;
  private final UserRepository users;
  private final RoleRepository roles;
  private final DictionaryItemRepository dictionaryItems;
  private final SettingService settings;
  private final com.mayday.content.NoticeRepository notices;
  private final com.mayday.content.ContentRevisionRepository revisions;
  private final AccessPolicy access;
  private final com.mayday.operations.repository.FlowDefinitionRepository workflows;

  private void guard(String kind, String action) {
    if (!KINDS.contains(kind)) throw new BusinessException("未知资源类型");
    access.require(kind + ":" + action);
    if ("departments".equals(kind) && !"view".equals(action) && !access.admin())
      throw new AccessDeniedException("组织结构会影响数据权限，仅超级管理员可调整");
  }

  /** 在资源白名单和该资源查看权限内分页查询，kind 谓词必须进入 SQL 而非事后过滤。 */
  @GetMapping("/{kind}")
  public ApiResponse<?> list(
      @PathVariable String kind,
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(required = false) String groupName,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    guard(kind, "view");
    return ApiResponse.ok(
        PageResult.from(
            entries.findAll(
                (root, query, criteria) -> {
                  var base =
                      criteria.and(
                          criteria.equal(root.get("kind"), kind),
                          criteria.or(
                              SearchPredicates.contains(criteria, root.get("name"), keyword),
                              SearchPredicates.contains(criteria, root.get("code"), keyword)));
                  if (groupName != null && !groupName.isBlank())
                    base = criteria.and(base, criteria.equal(root.get("groupName"), groupName));
                  return enabled == null
                      ? base
                      : criteria.and(base, criteria.equal(root.get("enabled"), enabled));
                },
                PageResult.request(page, size))));
  }

  /** 新增指定资源，组织结构写入额外要求管理员身份，避免间接扩大数据权限。 */
  @PostMapping("/{kind}")
  @Transactional
  public ApiResponse<?> create(
      @PathVariable String kind, @Valid @RequestBody EntryRequest request) {
    guard(kind, "create");
    return ApiResponse.ok(save(kind, null, request));
  }

  /** 修改同 kind 记录并验证原 version、父链、引用及业务字段，拒绝跨资源 ID 写入。 */
  @PutMapping("/{kind}/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable String kind, @PathVariable Long id, @Valid @RequestBody EntryRequest request) {
    guard(kind, "update");
    return ApiResponse.ok(save(kind, id, request));
  }

  private SystemEntry find(String kind, Long id) {
    return entries
        .findById(id)
        .filter(entry -> kind.equals(entry.getKind()))
        .orElseThrow(() -> new BusinessException("记录不存在"));
  }

  private SystemEntry save(String kind, Long id, EntryRequest request) {
    SystemEntry entity = id == null ? new SystemEntry() : find(kind, id);
    if (id != null) UserService.version(entity, request.version());
    if ("settings".equals(kind)) {
      if (entity.isBuiltIn() && !entity.getCode().equals(request.code()))
        throw new BusinessException("内置参数编码不能修改");
      var definition = SettingService.SITE_KEYS.get(request.code());
      String type =
          request.valueType() != null
              ? request.valueType()
              : definition != null ? definition.type() : entity.getValueType();
      settings.validate(request.code(), request.value(), type);
      entity.setValueType(type);
      entity.setGroupName(
          request.groupName() == null || request.groupName().isBlank()
              ? "通用"
              : request.groupName());
      entity.setBuiltIn(definition != null || entity.isBuiltIn());
      settings.invalidateAfterCommit();
    }
    if ("dictionaries".equals(kind)
        && id != null
        && "user.status".equals(entity.getCode())
        && !entity.getCode().equals(request.code())) throw new BusinessException("内置账号状态字典编码不能修改");
    if (java.util.Set.of("categories", "tags").contains(kind)) {
      if (request.name().length() > 32) throw new BusinessException("分类和标签名称最多 32 字");
    }
    if (request.parentId() != null) {
      if (!Set.of("departments", "menus").contains(kind)) throw new BusinessException("此资源不支持层级关系");
      SystemEntry parent = find(kind, request.parentId());
      Set<Long> visited = new HashSet<>();
      // 沿父链检查环，杜绝把父部门移动到自己的子部门之下。
      while (parent != null) {
        if (Objects.equals(parent.getId(), id) || !visited.add(parent.getId()))
          throw new BusinessException("上级节点不能是当前节点或其下级");
        parent = parent.getParentId() == null ? null : find(kind, parent.getParentId());
      }
    }
    if ("menus".equals(kind)) {
      NavigationCatalog.validate(request.path(), request.permission(), request.icon());
      if (request.parentId() != null) throw new BusinessException("菜单采用平铺分组，不配置上级菜单");
      if (entries.findByKindOrderBySortOrderAscIdAsc("menus").stream()
          .anyMatch(
              entry ->
                  !Objects.equals(entry.getId(), id) && request.path().equals(entry.getPath())))
        throw new BusinessException("此页面已有菜单入口，请编辑原入口");
    }
    if (request.leaderId() != null) {
      if (!"departments".equals(kind)) throw new BusinessException("只有部门可以指定负责人");
      users
          .findById(request.leaderId())
          .filter(SysUser::isEnabled)
          .orElseThrow(() -> new BusinessException("请选择有效的部门负责人"));
    }
    entity.setKind(kind);
    entity.setName(request.name());
    entity.setCode(request.code());
    if (!"dictionaries".equals(kind)) entity.setValue(request.value());
    entity.setDescription(request.description());
    entity.setParentId(request.parentId());
    entity.setLeaderId(request.leaderId());
    entity.setIcon(request.icon());
    entity.setSortOrder(request.sortOrder());
    entity.setPermission(request.permission());
    entity.setPath(request.path());
    entity.setEnabled(request.enabled());
    return entries.saveAndFlush(entity);
  }

  /** 删除前保护内置参数/字典，并检查子节点、账号、授权范围、内容和审批的所有关联。 */
  @DeleteMapping("/{kind}/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable String kind, @PathVariable Long id) {
    guard(kind, "delete");
    SystemEntry entry = find(kind, id);
    if ("approvalcategories".equals(kind) && workflows.existsByCategoryId(id))
      throw new BusinessException("分类仍被流程定义引用，请先调整关联");
    if ("settings".equals(kind)) {
      if (entry.isBuiltIn() || SettingService.SITE_KEYS.containsKey(entry.getCode()))
        throw new BusinessException("内置参数不能删除");
      settings.invalidateAfterCommit();
    }
    if (dictionaryItems.existsByDictionaryId(id)) throw new BusinessException("字典仍有选项，请先清理字典项");
    if ("posts".equals(kind)
        && users.count((root, query, criteria) -> criteria.isMember(id, root.get("postIds"))) > 0)
      throw new BusinessException("岗位仍被账号引用，请先调整关联");
    if ("dictionaries".equals(kind) && "user.status".equals(entry.getCode()))
      throw new BusinessException("内置账号状态字典不能删除");
    if (("categories".equals(kind) && revisions.existsByCategoryId(id))
        || ("tags".equals(kind) && revisions.existsByTagIdsContains(id)))
      throw new BusinessException("内容修订仍引用此分类或标签，不能删除；可停用以阻止新增选择");
    if (roles.existsByScopeDepartments_DepartmentId(id))
      throw new BusinessException("此部门仍被角色数据范围引用，请先调整授权");
    if (entries.existsByParentId(id)
        || users.existsByDepartmentId(id)
        || notices.existsByDepartmentId(id)) throw new BusinessException("记录仍被子节点、用户或内容引用，请先调整关联");
    entries.delete(entry);
    return ApiResponse.ok(null);
  }

  private boolean contentReferences(String kind, String name) {
    if ("categories".equals(kind))
      return notices.count((root, query, criteria) -> criteria.equal(root.get("category"), name))
          > 0;
    if ("tags".equals(kind))
      return notices.count((root, query, criteria) -> criteria.isMember(name, root.get("tags")))
          > 0;
    return false;
  }
}
