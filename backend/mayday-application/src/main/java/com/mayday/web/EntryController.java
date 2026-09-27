package com.mayday.web;

import com.mayday.common.*;
import com.mayday.security.*;
import com.mayday.service.NavigationCatalog;
import com.mayday.service.SettingService;
import com.mayday.service.UserService;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import com.mayday.web.Contracts.*;
import jakarta.validation.Valid;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

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
                (r, q, c) -> {
                  var base =
                      c.and(
                          c.equal(r.get("kind"), kind),
                          c.or(
                              SearchPredicates.contains(c, r.get("name"), keyword),
                              SearchPredicates.contains(c, r.get("code"), keyword)));
                  if (groupName != null && !groupName.isBlank())
                    base = c.and(base, c.equal(r.get("groupName"), groupName));
                  return enabled == null ? base : c.and(base, c.equal(r.get("enabled"), enabled));
                },
                PageResult.request(page, size))));
  }

  @PostMapping("/{kind}")
  @Transactional
  public ApiResponse<?> create(@PathVariable String kind, @Valid @RequestBody EntryRequest req) {
    guard(kind, "create");
    return ApiResponse.ok(save(kind, null, req));
  }

  @PutMapping("/{kind}/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable String kind, @PathVariable Long id, @Valid @RequestBody EntryRequest req) {
    guard(kind, "update");
    return ApiResponse.ok(save(kind, id, req));
  }

  private SystemEntry find(String kind, Long id) {
    return entries
        .findById(id)
        .filter(e -> kind.equals(e.getKind()))
        .orElseThrow(() -> new BusinessException("记录不存在"));
  }

  private SystemEntry save(String kind, Long id, EntryRequest req) {
    SystemEntry entity = id == null ? new SystemEntry() : find(kind, id);
    if (id != null) UserService.version(entity, req.version());
    if ("settings".equals(kind)) {
      if (entity.isBuiltIn() && !entity.getCode().equals(req.code()))
        throw new BusinessException("内置参数编码不能修改");
      var definition = SettingService.SITE_KEYS.get(req.code());
      String type =
          req.valueType() != null
              ? req.valueType()
              : definition != null ? definition.type() : entity.getValueType();
      settings.validate(req.code(), req.value(), type);
      entity.setValueType(type);
      entity.setGroupName(
          req.groupName() == null || req.groupName().isBlank() ? "通用" : req.groupName());
      entity.setBuiltIn(definition != null || entity.isBuiltIn());
      settings.invalidateAfterCommit();
    }
    if ("dictionaries".equals(kind)
        && id != null
        && "user.status".equals(entity.getCode())
        && !entity.getCode().equals(req.code())) throw new BusinessException("内置账号状态字典编码不能修改");
    if (java.util.Set.of("categories", "tags").contains(kind)) {
      if (req.name().length() > 32) throw new BusinessException("分类和标签名称最多 32 字");
    }
    if (req.parentId() != null) {
      if (!Set.of("departments", "menus").contains(kind)) throw new BusinessException("此资源不支持层级关系");
      SystemEntry parent = find(kind, req.parentId());
      Set<Long> visited = new HashSet<>();
      // 沿父链检查环，杜绝把父部门移动到自己的子部门之下。
      while (parent != null) {
        if (Objects.equals(parent.getId(), id) || !visited.add(parent.getId()))
          throw new BusinessException("上级节点不能是当前节点或其下级");
        parent = parent.getParentId() == null ? null : find(kind, parent.getParentId());
      }
    }
    if ("menus".equals(kind)) {
      NavigationCatalog.validate(req.path(), req.permission(), req.icon());
      if (req.parentId() != null) throw new BusinessException("菜单采用平铺分组，不配置上级菜单");
      if (entries.findByKindOrderBySortOrderAscIdAsc("menus").stream()
          .anyMatch(e -> !Objects.equals(e.getId(), id) && req.path().equals(e.getPath())))
        throw new BusinessException("此页面已有菜单入口，请编辑原入口");
    }
    if (req.leaderId() != null) {
      if (!"departments".equals(kind)) throw new BusinessException("只有部门可以指定负责人");
      users
          .findById(req.leaderId())
          .filter(SysUser::isEnabled)
          .orElseThrow(() -> new BusinessException("请选择有效的部门负责人"));
    }
    entity.setKind(kind);
    entity.setName(req.name());
    entity.setCode(req.code());
    if (!"dictionaries".equals(kind)) entity.setValue(req.value());
    entity.setDescription(req.description());
    entity.setParentId(req.parentId());
    entity.setLeaderId(req.leaderId());
    entity.setIcon(req.icon());
    entity.setSortOrder(req.sortOrder());
    entity.setPermission(req.permission());
    entity.setPath(req.path());
    entity.setEnabled(req.enabled());
    return entries.saveAndFlush(entity);
  }

  @DeleteMapping("/{kind}/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable String kind, @PathVariable Long id) {
    guard(kind, "delete");
    SystemEntry e = find(kind, id);
    if ("approvalcategories".equals(kind) && workflows.existsByCategoryId(id))
      throw new BusinessException("分类仍被流程定义引用，请先调整关联");
    if ("settings".equals(kind)) {
      if (e.isBuiltIn() || SettingService.SITE_KEYS.containsKey(e.getCode()))
        throw new BusinessException("内置参数不能删除");
      settings.invalidateAfterCommit();
    }
    if (dictionaryItems.existsByDictionaryId(id)) throw new BusinessException("字典仍有选项，请先清理字典项");
    if ("posts".equals(kind) && users.count((r, q, c) -> c.isMember(id, r.get("postIds"))) > 0)
      throw new BusinessException("岗位仍被账号引用，请先调整关联");
    if ("dictionaries".equals(kind) && "user.status".equals(e.getCode()))
      throw new BusinessException("内置账号状态字典不能删除");
    if (("categories".equals(kind) && revisions.existsByCategoryId(id))
        || ("tags".equals(kind) && revisions.existsByTagIdsContains(id)))
      throw new BusinessException("内容修订仍引用此分类或标签，不能删除；可停用以阻止新增选择");
    if (roles.existsByScopeDepartments_DepartmentId(id))
      throw new BusinessException("此部门仍被角色数据范围引用，请先调整授权");
    if (entries.existsByParentId(id)
        || users.existsByDepartmentId(id)
        || notices.existsByDepartmentId(id)) throw new BusinessException("记录仍被子节点、用户或内容引用，请先调整关联");
    entries.delete(e);
    return ApiResponse.ok(null);
  }

  private boolean contentReferences(String kind, String name) {
    if ("categories".equals(kind))
      return notices.count((r, q, c) -> c.equal(r.get("category"), name)) > 0;
    if ("tags".equals(kind)) return notices.count((r, q, c) -> c.isMember(name, r.get("tags"))) > 0;
    return false;
  }
}
