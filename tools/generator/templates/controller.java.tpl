package com.mayday.{{module}};

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.{{module}}.{{entity}}Contracts.{{entity}}Request;
import com.mayday.{{module}}.{{entity}}Contracts.{{entity}}View;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** {{label}} REST 接口；显式响应泛型让 OpenAPI 及前端类型生成器获得真实数据结构。 */
@RestController
@RequestMapping("/api/business/{{resource}}")
@RequiredArgsConstructor
public class {{entity}}Controller {
  private final {{entity}}Service service;

  @GetMapping
  @PreAuthorize("@access.has('{{resource}}:view')")
  public ApiResponse<PageResult<{{entity}}View>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(keyword, enabled, page, size));
  }

  @GetMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:view')")
  public ApiResponse<{{entity}}View> get(@PathVariable Long id) {
    return ApiResponse.ok(service.get(id));
  }

  @PostMapping
  @PreAuthorize("@access.has('{{resource}}:create')")
  public ApiResponse<{{entity}}View> create(@Valid @RequestBody {{entity}}Request request) {
    return ApiResponse.ok(service.create(request));
  }

  @PutMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:update')")
  public ApiResponse<{{entity}}View> update(@PathVariable Long id, @Valid @RequestBody {{entity}}Request request) {
    return ApiResponse.ok(service.update(id, request));
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:delete')")
  public ApiResponse<Void> delete(@PathVariable Long id, @RequestParam Long version) {
    service.delete(id, version);
    return ApiResponse.ok(null);
  }
}
