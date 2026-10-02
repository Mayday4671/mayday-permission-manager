package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.service.UserService;
import com.mayday.web.Contracts.ResetPasswordRequest;
import com.mayday.web.Contracts.UserRequest;
import com.mayday.web.Contracts.UserStatusRequest;
import com.mayday.web.Contracts.UserView;
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

/** 用户接口的每个动作独立授权，导出与重置密码不复用编辑权限。 */
@RestController
@RequestMapping("/api/system/users")
@RequiredArgsConstructor
public class UserController {
  private final UserService service;

  /** 在 users:view 及当前 SQL 数据范围内分页，并由服务层按字段权限投影联系方式。 */
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

  /** 兼容旧客户端的 100 行分批导出，仍使用列表的 SQL 范围及字段权限；大批量改走异步作业。 */
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

  /** 新增账号后由服务层校验密码、部门、岗位、角色授予边界及敏感字段写权限。 */
  @PostMapping
  @PreAuthorize("@access.has('users:create')")
  public ApiResponse<UserView> create(@Valid @RequestBody UserRequest request) {
    return ApiResponse.ok(service.save(null, request));
  }

  /** 编辑指定范围内账号，必须通过原 version 与字段/角色权限检查，禁止实体直接绑定。 */
  @PutMapping("/{id}")
  @PreAuthorize("@access.has('users:update')")
  public ApiResponse<UserView> update(
      @PathVariable Long id, @Valid @RequestBody UserRequest request) {
    return ApiResponse.ok(service.save(id, request));
  }

  /** 删除仅作用于获授权范围内的非保护账号，并由服务层处理关联与会话撤销。 */
  @DeleteMapping("/{id}")
  @PreAuthorize("@access.has('users:delete')")
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  /** 批量状态变更逐个校验目标范围和版本，整个操作原子提交，不能停用保护管理员。 */
  @PutMapping("/status")
  @PreAuthorize("@access.has('users:update')")
  public ApiResponse<?> status(@Valid @RequestBody UserStatusRequest request) {
    service.changeStatus(request);
    return ApiResponse.ok(null);
  }

  /** 重置密码使用独立权限，验证目标数据范围与密码规则，并撤销目标用户已有会话。 */
  @PutMapping("/{id}/password")
  @PreAuthorize("@access.has('users:reset')")
  public ApiResponse<?> reset(
      @PathVariable Long id, @Valid @RequestBody ResetPasswordRequest request) {
    service.reset(id, request.password());
    return ApiResponse.ok(null);
  }
}
