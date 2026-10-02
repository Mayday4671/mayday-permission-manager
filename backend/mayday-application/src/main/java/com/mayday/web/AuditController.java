package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.service.AuditQueryService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 操作日志与登录日志共用传输入口，查看、导出和清理分别由审计服务检查独立权限。 */
@RestController
@RequestMapping("/api/system/logs")
@RequiredArgsConstructor
public class AuditController {
  private final AuditQueryService service;

  /** 按日志种类、结果和日期分页；loginOnly 选择种类，不能替代该种类的查看授权。 */
  @GetMapping
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean success,
      @RequestParam(defaultValue = "false") boolean loginOnly,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(loginOnly, keyword, success, from, to, page, size, false));
  }

  /** 导出使用独立权限并固定每批 100 行，调用方只能继续合法分页，不能自行取消范围。 */
  @GetMapping("/export")
  public ApiResponse<?> export(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean success,
      @RequestParam(defaultValue = "false") boolean loginOnly,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(defaultValue = "1") int page) {
    return ApiResponse.ok(service.list(loginOnly, keyword, success, from, to, page, 100, true));
  }

  /** 详情同时校验日志 ID 与种类，避免使用登录日志权限读取操作日志详情。 */
  @GetMapping("/{id}")
  public ApiResponse<?> detail(
      @PathVariable Long id, @RequestParam(defaultValue = "false") boolean loginOnly) {
    return ApiResponse.ok(service.detail(loginOnly, id));
  }

  /** 显式清理某类日志在指定日期之前的记录，业务服务限制保留期限与清理权限。 */
  public record Cleanup(@NotNull LocalDate before, boolean loginOnly) {}

  /** 按批准的日期范围清理日志；普通查看权限不自动获得破坏审计记录的能力。 */
  @DeleteMapping
  public ApiResponse<?> clean(@Valid @RequestBody Cleanup request) {
    return ApiResponse.ok(service.clean(request.loginOnly(), request.before()));
  }
}
