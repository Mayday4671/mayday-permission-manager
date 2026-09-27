package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.service.AuditQueryService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/system/logs")
@RequiredArgsConstructor
public class AuditController {
  private final AuditQueryService service;

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

  @GetMapping("/{id}")
  public ApiResponse<?> detail(
      @PathVariable Long id, @RequestParam(defaultValue = "false") boolean loginOnly) {
    return ApiResponse.ok(service.detail(loginOnly, id));
  }

  public record Cleanup(@NotNull LocalDate before, boolean loginOnly) {}

  @DeleteMapping
  public ApiResponse<?> clean(@Valid @RequestBody Cleanup request) {
    return ApiResponse.ok(service.clean(request.loginOnly(), request.before()));
  }
}
