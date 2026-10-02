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

  /** 查询已授权的数据分页；总数与条目共享数据范围条件，不能通过计数泄露范围外记录。 */
  @GetMapping
  @PreAuthorize("@access.has('{{resource}}:view')")
  public ApiResponse<PageResult<{{entity}}View>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(keyword, enabled, page, size));
  }

  /** 按主键读取仍需通过业务层范围检查，具有查看动作并不代表可以访问所有记录。 */
  @GetMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:view')")
  public ApiResponse<{{entity}}View> get(@PathVariable Long id) {
    return ApiResponse.ok(service.get(id));
  }

  /** 只接收已校验的业务字段；创建者、部门与时间由有效登录身份及服务器赋值。 */
  @PostMapping
  @PreAuthorize("@access.has('{{resource}}:create')")
  public ApiResponse<{{entity}}View> create(@Valid @RequestBody {{entity}}Request request) {
    return ApiResponse.ok(service.create(request));
  }

  /** 修改要求动作权限、行级范围和当前版本同时满足；并发冲突返回失败而非覆盖别人修改。 */
  @PutMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:update')")
  public ApiResponse<{{entity}}View> update(@PathVariable Long id, @Valid @RequestBody {{entity}}Request request) {
    return ApiResponse.ok(service.update(id, request));
  }

  /** 删除显式提交当前版本，业务层再检查范围与数据库引用；任何校验失败都不会部分删除。 */
  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('{{resource}}:delete')")
  public ApiResponse<Void> delete(@PathVariable Long id, @RequestParam Long version) {
    service.delete(id, version);
    return ApiResponse.ok(null);
  }
}
