package com.mayday.web;

import com.mayday.common.*;
import com.mayday.service.UserService;
import com.mayday.web.Contracts.*;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** 用户接口的每个动作独立授权，导出与重置密码不复用编辑权限。 */
@RestController
@RequestMapping("/api/system/users")
@RequiredArgsConstructor
public class UserController {
  private final UserService service;

  @GetMapping
  @PreAuthorize("@access.has('users:view')")
  public ApiResponse<PageResult<UserView>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(required = false) Long departmentId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(keyword, enabled, departmentId, page, size));
  }

  @GetMapping("/export")
  @PreAuthorize("@access.has('users:export') and @access.has('users:view')")
  public ApiResponse<PageResult<UserView>> export(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(required = false) Long departmentId,
      @RequestParam(defaultValue = "1") int page) {
    // 分批导出沿用查询范围及敏感字段策略，前端逐页下载，不存在绕过权限的全量 SQL。
    return ApiResponse.ok(service.list(keyword, enabled, departmentId, page, 100));
  }

  @PostMapping
  @PreAuthorize("@access.has('users:create')")
  public ApiResponse<UserView> create(@Valid @RequestBody UserRequest req) {
    return ApiResponse.ok(service.save(null, req));
  }

  @PutMapping("/{id}")
  @PreAuthorize("@access.has('users:update')")
  public ApiResponse<UserView> update(@PathVariable Long id, @Valid @RequestBody UserRequest req) {
    return ApiResponse.ok(service.save(id, req));
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('users:delete')")
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  @PutMapping("/status")
  @PreAuthorize("@access.has('users:update')")
  public ApiResponse<?> status(@Valid @RequestBody UserStatusRequest req) {
    service.changeStatus(req);
    return ApiResponse.ok(null);
  }

  @PutMapping("/{id}/password")
  @PreAuthorize("@access.has('users:reset')")
  public ApiResponse<?> reset(@PathVariable Long id, @Valid @RequestBody ResetPasswordRequest req) {
    service.reset(id, req.password());
    return ApiResponse.ok(null);
  }
}
