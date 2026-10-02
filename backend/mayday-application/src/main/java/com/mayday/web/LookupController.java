package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.service.NavigationCatalog;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 表单选项接口只返回最小字段；导航仍由服务端菜单配置与用户实际权限共同决定。 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class LookupController {
  private final EntryRepository entries;
  private final RoleRepository roles;
  private final UserRepository users;
  private final AccessPolicy access;
  private final com.mayday.common.ModuleSwitches modules;

  /** 选择器遵守同一用户数据范围，永不因下拉框泄露范围外账号或联系方式。 */
  @GetMapping("/options/{kind}")
  public ApiResponse<?> options(
      @PathVariable String kind,
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "30") int size) {
    if ("users".equals(kind)) {
      access.require("users:view");
      var found =
          users.findAll(
              (root, query, criteria) ->
                  criteria.and(
                      access.<SysUser>filter("users", "id").toPredicate(root, query, criteria),
                      criteria.isTrue(root.get("enabled")),
                      criteria.or(
                          SearchPredicates.contains(criteria, root.get("nickname"), keyword),
                          SearchPredicates.contains(criteria, root.get("username"), keyword))),
              PageResult.request(page, size));
      return ApiResponse.ok(
          PageResult.from(
              found.map(
                  user ->
                      Map.of(
                          "value",
                          user.getId(),
                          "label",
                          user.getNickname() + " · " + user.getUsername()))));
    }
    if (!Set.of("categories", "tags", "approvalcategories").contains(kind))
      throw new BusinessException("未知选项类型");
    if ("approvalcategories".equals(kind)) {
      if (!access.has("workflows:view") && !access.has("requests:create"))
        access.require("approvalcategories:view");
    } else if (!access.has("notices:view")) access.require(kind + ":view");
    var found =
        entries.findAll(
            (root, query, criteria) ->
                criteria.and(
                    criteria.equal(root.get("kind"), kind),
                    criteria.isTrue(root.get("enabled")),
                    SearchPredicates.contains(criteria, root.get("name"), keyword)),
            PageResult.request(page, size));
    return ApiResponse.ok(
        PageResult.from(
            found.map(entry -> Map.of("value", entry.getId(), "label", entry.getName()))));
  }

  /** 菜单只包含启用、注册路由匹配且当前用户有权的入口；关闭门户时移除其管理入口。 */
  @GetMapping("/navigation")
  public ApiResponse<?> navigation() {
    return ApiResponse.ok(
        entries.findByKindOrderBySortOrderAscIdAsc("menus").stream()
            .filter(SystemEntry::isEnabled)
            .filter(entry -> NavigationCatalog.matches(entry.getPath(), entry.getPermission()))
            .filter(
                entry ->
                    !"/admin/site-settings".equals(entry.getPath()) || modules.isEnabled("portal"))
            .filter(entry -> entry.getPermission() != null && access.has(entry.getPermission()))
            .toList());
  }

  /** 表单基础选项按使用场景授权返回；角色还需通过可授予范围校验，不输出角色完整权限。 */
  @GetMapping("/lookups")
  public ApiResponse<?> lookups() {
    List<?> departments = List.of();
    List<?> roleOptions = List.of();
    if (access.has("users:view")
        || access.has("departments:view")
        || access.has("requests:create")
        || access.has("workflows:view"))
      departments =
          entries.findByKindOrderBySortOrderAscIdAsc("departments").stream()
              .map(
                  entry -> {
                    Map<String, Object> option = new LinkedHashMap<>();
                    option.put("id", entry.getId());
                    option.put("name", entry.getName());
                    option.put("parentId", entry.getParentId());
                    option.put("enabled", entry.isEnabled());
                    return option;
                  })
              .toList();
    if (access.has("users:assign") || access.has("roles:view"))
      roleOptions =
          roles.findAll().stream()
              .filter(SysRole::isEnabled)
              .filter(
                  role -> {
                    try {
                      access.checkGrant(List.of(role));
                      return true;
                    } catch (org.springframework.security.access.AccessDeniedException ex) {
                      return false;
                    }
                  })
              .map(
                  role ->
                      Map.of("id", role.getId(), "name", role.getName(), "code", role.getCode()))
              .toList();
    var posts =
        access.has("users:view") || access.has("posts:view")
            ? entries.findByKindOrderBySortOrderAscIdAsc("posts").stream()
                .filter(SystemEntry::isEnabled)
                .map(entry -> Map.of("id", entry.getId(), "name", entry.getName()))
                .toList()
            : List.of();
    return ApiResponse.ok(Map.of("departments", departments, "roles", roleOptions, "posts", posts));
  }
}
