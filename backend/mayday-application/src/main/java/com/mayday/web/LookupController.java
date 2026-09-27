package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.service.NavigationCatalog;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 表单选项接口只返回最小字段；导航仍由服务端菜单配置与用户实际权限共同决定。 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class LookupController {
  private final EntryRepository entries;
  private final RoleRepository roles;
  private final UserRepository users;
  private final AccessPolicy access;

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
              (r, q, c) ->
                  c.and(
                      access.<SysUser>filter("users", "id").toPredicate(r, q, c),
                      c.isTrue(r.get("enabled")),
                      c.or(
                          SearchPredicates.contains(c, r.get("nickname"), keyword),
                          SearchPredicates.contains(c, r.get("username"), keyword))),
              PageResult.request(page, size));
      return ApiResponse.ok(
          PageResult.from(
              found.map(
                  u ->
                      Map.of(
                          "value",
                          u.getId(),
                          "label",
                          u.getNickname() + " · " + u.getUsername()))));
    }
    if (!Set.of("categories", "tags", "approvalcategories").contains(kind))
      throw new BusinessException("未知选项类型");
    if ("approvalcategories".equals(kind)) {
      if (!access.has("workflows:view") && !access.has("requests:create"))
        access.require("approvalcategories:view");
    } else if (!access.has("notices:view")) access.require(kind + ":view");
    var found =
        entries.findAll(
            (r, q, c) ->
                c.and(
                    c.equal(r.get("kind"), kind),
                    c.isTrue(r.get("enabled")),
                    SearchPredicates.contains(c, r.get("name"), keyword)),
            PageResult.request(page, size));
    return ApiResponse.ok(
        PageResult.from(found.map(e -> Map.of("value", e.getId(), "label", e.getName()))));
  }

  @GetMapping("/navigation")
  public ApiResponse<?> navigation() {
    return ApiResponse.ok(
        entries.findByKindOrderBySortOrderAscIdAsc("menus").stream()
            .filter(SystemEntry::isEnabled)
            .filter(e -> NavigationCatalog.matches(e.getPath(), e.getPermission()))
            .filter(e -> e.getPermission() != null && access.has(e.getPermission()))
            .toList());
  }

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
                  e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", e.getId());
                    m.put("name", e.getName());
                    m.put("parentId", e.getParentId());
                    m.put("enabled", e.isEnabled());
                    return m;
                  })
              .toList();
    if (access.has("users:assign") || access.has("roles:view"))
      roleOptions =
          roles.findAll().stream()
              .filter(SysRole::isEnabled)
              .filter(
                  r -> {
                    try {
                      access.checkGrant(List.of(r));
                      return true;
                    } catch (org.springframework.security.access.AccessDeniedException ex) {
                      return false;
                    }
                  })
              .map(r -> Map.of("id", r.getId(), "name", r.getName(), "code", r.getCode()))
              .toList();
    var posts =
        access.has("users:view") || access.has("posts:view")
            ? entries.findByKindOrderBySortOrderAscIdAsc("posts").stream()
                .filter(SystemEntry::isEnabled)
                .map(e -> Map.of("id", e.getId(), "name", e.getName()))
                .toList()
            : List.of();
    return ApiResponse.ok(Map.of("departments", departments, "roles", roleOptions, "posts", posts));
  }
}
