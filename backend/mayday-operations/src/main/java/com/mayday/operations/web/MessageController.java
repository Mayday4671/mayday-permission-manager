package com.mayday.operations.web;

import com.mayday.common.*;
import com.mayday.operations.NotificationService;
import com.mayday.operations.repository.*;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 控制器只负责契约、分页和操作权限；范围、状态、事务及附件关联在业务服务中统一处理。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MessageController {
  private final NotificationService service;
  private final NotificationRepository notifications;
  private final DeliveryRepository deliveries;
  private final UserRepository users;
  private final AccessPolicy access;

  @GetMapping("/people")
  public ApiResponse<?> people() {
    access.require("users:view");
    return ApiResponse.ok(
        users
            .findAll(
                access.<SysUser>filter("users", "id").and((r, q, c) -> c.isTrue(r.get("enabled"))))
            .stream()
            .map(u -> Map.of("id", u.getId(), "name", u.getNickname(), "username", u.getUsername()))
            .toList());
  }

  @GetMapping("/notifications/options/{kind}")
  public ApiResponse<?> options(@PathVariable String kind) {
    return ApiResponse.ok(service.recipientOptions(kind));
  }

  @GetMapping("/notifications")
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("notifications:view");
    var spec =
        service
            .manageable()
            .and(NotificationService.state(status))
            .and((r, q, c) -> SearchPredicates.contains(c, r.get("title"), keyword));
    return ApiResponse.ok(
        PageResult.from(
            notifications.findAll(spec, PageResult.request(page, size)).map(service::view)));
  }

  @GetMapping("/notifications/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(service.view(service.getManaged(id)));
  }

  @GetMapping("/notifications/{id}/recipients")
  public ApiResponse<?> recipients(
      @PathVariable Long id,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    service.getManaged(id);
    return ApiResponse.ok(
        PageResult.from(
            deliveries
                .findAll(
                    (r, q, c) -> c.equal(r.get("notification").get("id"), id),
                    PageResult.request(page, size))
                .map(
                    d ->
                        Map.of(
                            "id",
                            d.getId(),
                            "name",
                            d.getRecipientName(),
                            "readAt",
                            d.getReadAt() == null ? "" : d.getReadAt().toString()))));
  }

  @PostMapping("/notifications")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody NotificationService.Draft request) {
    return ApiResponse.ok(service.save(null, request));
  }

  @PutMapping("/notifications/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Draft request) {
    return ApiResponse.ok(service.save(id, request));
  }

  @PostMapping("/notifications/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Version request) {
    return ApiResponse.ok(service.publish(id, request.version()));
  }

  @PostMapping("/notifications/{id}/withdraw")
  @Transactional
  public ApiResponse<?> withdraw(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Version request) {
    return ApiResponse.ok(service.withdraw(id, request.version()));
  }

  @PostMapping("/notifications/{id}/copy")
  @Transactional
  public ApiResponse<?> copy(@PathVariable Long id) {
    return ApiResponse.ok(service.copy(id));
  }

  @DeleteMapping("/notifications/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  @GetMapping("/messages")
  public ApiResponse<?> inbox(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean read,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("messages:view");
    return ApiResponse.ok(
        PageResult.from(
            deliveries
                .findAll(service.visibleInbox(read, keyword), PageResult.request(page, size))
                .map(service::inbox)));
  }

  @GetMapping("/messages/unread")
  public ApiResponse<?> unread() {
    access.require("messages:view");
    return ApiResponse.ok(deliveries.count(service.visibleInbox(false, "")));
  }

  @GetMapping("/messages/{id}")
  public ApiResponse<?> message(@PathVariable Long id) {
    return ApiResponse.ok(service.detail(id));
  }

  @PostMapping("/messages/{id}/read")
  @Transactional
  public ApiResponse<?> read(@PathVariable Long id) {
    service.read(id);
    return ApiResponse.ok(null);
  }

  @PostMapping("/messages/read-all")
  @Transactional
  public ApiResponse<?> readAll() {
    return ApiResponse.ok(service.readAll());
  }
}
