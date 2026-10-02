package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.service.UserService;
import com.mayday.system.model.DictionaryItem;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.DictionaryItemRepository;
import com.mayday.system.repository.EntryRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
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

/** 字典维护与业务选项读取分离。每次保存检查类型归属、唯一约束和版本，防止跨类型修改。 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class DictionaryController {
  private final EntryRepository entries;
  private final DictionaryItemRepository items;
  private final AccessPolicy access;

  /** 字典选项可编辑字段；颜色只允许主题支持的标识，更新必须携带原 version。 */
  @Schema(name = "DictionaryItemEdit")
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
        .filter(entry -> "dictionaries".equals(entry.getKind()))
        .orElseThrow(() -> new BusinessException("字典类型不存在"));
  }

  private DictionaryItem find(Long typeId, Long id) {
    return items
        .findById(id)
        .filter(item -> typeId.equals(item.getDictionaryId()))
        .orElseThrow(() -> new BusinessException("字典项不存在"));
  }

  /** 仅在指定真实字典类型内分页，类型 ID 和停用项均不绕过 dictionaries:view 权限。 */
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
                (root, query, criteria) ->
                    criteria.and(
                        criteria.equal(root.get("dictionaryId"), typeId),
                        criteria.or(
                            SearchPredicates.contains(criteria, root.get("label"), keyword),
                            SearchPredicates.contains(criteria, root.get("value"), keyword)),
                        enabled == null
                            ? criteria.conjunction()
                            : criteria.equal(root.get("enabled"), enabled)),
                PageRequest.of(
                    paging.getPageNumber(), paging.getPageSize(), Sort.by("sortOrder", "id")))));
  }

  /** 新选项固定属于路径指定字典，内置账号状态的值仍受 true/false 契约约束。 */
  @PostMapping("/dictionaries/{typeId}/items")
  @Transactional
  public ApiResponse<?> create(@PathVariable Long typeId, @Valid @RequestBody Edit request) {
    access.require("dictionaries:create");
    return ApiResponse.ok(save(typeId, null, request));
  }

  /** 验证选项归属及版本后更新，不能通过其他字典路径编辑同一个 ID。 */
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

  /** 只删除对应字典内的普通选项，内置账号状态选项允许停用但禁止破坏性删除。 */
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
            .filter(entry -> entry.isEnabled() && code.equals(entry.getCode()))
            .findFirst();
    return ApiResponse.ok(
        dictionary
            .map(
                entry ->
                    items
                        .findByDictionaryIdAndEnabledTrueOrderBySortOrderAscIdAsc(entry.getId())
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
