package com.mayday.web;

import com.mayday.common.*;
import com.mayday.security.AccessPolicy;
import com.mayday.service.UserService;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 字典维护与业务选项读取分离。每次保存检查类型归属、唯一约束和版本，防止跨类型修改。 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class DictionaryController {
  private final EntryRepository entries;
  private final DictionaryItemRepository items;
  private final AccessPolicy access;

  public record Edit(
      @NotBlank @Size(max = 100) String label,
      @NotBlank @Size(max = 100) String value,
      @Pattern(
              regexp = "default|success|warning|error|processing|blue|purple|cyan|green|orange|red")
          String color,
      @Min(0) @Max(9999) int sortOrder,
      boolean enabled,
      Long version) {}

  private SystemEntry type(Long id) {
    return entries
        .findById(id)
        .filter(e -> "dictionaries".equals(e.getKind()))
        .orElseThrow(() -> new BusinessException("字典类型不存在"));
  }

  private DictionaryItem find(Long typeId, Long id) {
    return items
        .findById(id)
        .filter(item -> typeId.equals(item.getDictionaryId()))
        .orElseThrow(() -> new BusinessException("字典项不存在"));
  }

  @GetMapping("/dictionaries/{typeId}/items")
  public ApiResponse<?> list(
      @PathVariable Long typeId,
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("dictionaries:view");
    type(typeId);
    var paging = PageResult.request(page, size);
    return ApiResponse.ok(
        PageResult.from(
            items.findAll(
                (r, q, c) ->
                    c.and(
                        c.equal(r.get("dictionaryId"), typeId),
                        c.or(
                            SearchPredicates.contains(c, r.get("label"), keyword),
                            SearchPredicates.contains(c, r.get("value"), keyword)),
                        enabled == null ? c.conjunction() : c.equal(r.get("enabled"), enabled)),
                PageRequest.of(
                    paging.getPageNumber(), paging.getPageSize(), Sort.by("sortOrder", "id")))));
  }

  @PostMapping("/dictionaries/{typeId}/items")
  @Transactional
  public ApiResponse<?> create(@PathVariable Long typeId, @Valid @RequestBody Edit request) {
    access.require("dictionaries:create");
    return ApiResponse.ok(save(typeId, null, request));
  }

  @PutMapping("/dictionaries/{typeId}/items/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable Long typeId, @PathVariable Long id, @Valid @RequestBody Edit request) {
    access.require("dictionaries:update");
    return ApiResponse.ok(save(typeId, id, request));
  }

  private DictionaryItem save(Long typeId, Long id, Edit request) {
    var dictionary = type(typeId);
    var item = id == null ? new DictionaryItem() : find(typeId, id);
    if (id != null) UserService.version(item, request.version());
    // 内置业务字典的值是契约，标签可以改，但不能将 true 改成任意字符串后破坏账号状态含义。
    if ("user.status".equals(dictionary.getCode())
        && !Set.of("true", "false").contains(request.value()))
      throw new BusinessException("账号状态字典值仅支持 true 或 false");
    item.setDictionaryId(typeId);
    item.setLabel(request.label().trim());
    item.setValue(request.value().trim());
    item.setColor(request.color());
    item.setSortOrder(request.sortOrder());
    item.setEnabled(request.enabled());
    return items.saveAndFlush(item);
  }

  @DeleteMapping("/dictionaries/{typeId}/items/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long typeId, @PathVariable Long id) {
    access.require("dictionaries:delete");
    var dictionary = type(typeId);
    if ("user.status".equals(dictionary.getCode())) throw new BusinessException("内置账号状态项可停用，不能删除");
    items.delete(find(typeId, id));
    return ApiResponse.ok(null);
  }

  /** 登录后可读取已启用的展示字典；不给维护权限，不返回停用项和内部管理字段。 */
  @GetMapping("/dictionary-options/{code}")
  public ApiResponse<?> options(@PathVariable String code) {
    var dictionary =
        entries.findByKindOrderBySortOrderAscIdAsc("dictionaries").stream()
            .filter(e -> e.isEnabled() && code.equals(e.getCode()))
            .findFirst();
    return ApiResponse.ok(
        dictionary
            .map(
                e ->
                    items
                        .findByDictionaryIdAndEnabledTrueOrderBySortOrderAscIdAsc(e.getId())
                        .stream()
                        .map(
                            item ->
                                Map.of(
                                    "value",
                                    item.getValue(),
                                    "label",
                                    item.getLabel(),
                                    "color",
                                    Objects.toString(item.getColor(), "default")))
                        .toList())
            .orElse(List.of()));
  }
}
