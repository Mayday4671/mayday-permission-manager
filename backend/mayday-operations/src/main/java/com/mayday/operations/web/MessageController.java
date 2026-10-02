package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.NotificationService;
import com.mayday.operations.repository.DeliveryRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
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

  /** 人员选项同时按 users:view、启用状态与当前用户数据范围查询，不能从全量账号在前端裁剪。 */
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

  /** 群发部门或角色仅返回当前发送者可完整覆盖的直接成员组，服务端再次校验发布目标。 */
  @GetMapping("/notifications/options/{kind}")
  public ApiResponse<?> options(@PathVariable String kind) {
    return ApiResponse.ok(service.recipientOptions(kind));
  }

  /** 通知管理列表按可管理发件范围及状态分页，不能使用收件人的阅读权查看其他发件人草稿。 */
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

  /** 通知详情重新核验发件管理范围，附件元信息不替代附件下载接口的独立鉴权。 */
  @GetMapping("/notifications/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(service.view(service.getManaged(id)));
  }

  /** 阅读统计只允许该通知的管理者查询，阅读时间保留原值且名单分页返回。 */
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

  /** 创建草稿同时验证收件范围、附件归属和正文清洗，不立即发送消息。 */
  @PostMapping("/notifications")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody NotificationService.Draft request) {
    return ApiResponse.ok(service.save(null, request));
  }

  /** 仅编辑可管理草稿并校验乐观版本，已发布正文禁止原地覆盖。 */
  @PutMapping("/notifications/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Draft request) {
    return ApiResponse.ok(service.save(id, request));
  }

  /** 独立发布权限冻结收件者并事务生成投递；安全重试不重复发送。 */
  @PostMapping("/notifications/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Version request) {
    return ApiResponse.ok(service.publish(id, request.version()));
  }

  /** 撤回权限与管理范围都通过后阻断接收端读取，历史阅读记录继续保留。 */
  @PostMapping("/notifications/{id}/withdraw")
  @Transactional
  public ApiResponse<?> withdraw(
      @PathVariable Long id, @Valid @RequestBody NotificationService.Version request) {
    return ApiResponse.ok(service.withdraw(id, request.version()));
  }

  /** 复制已鉴权原通知生成新草稿，附件须重新验证，不继承原发布和阅读状态。 */
  @PostMapping("/notifications/{id}/copy")
  @Transactional
  public ApiResponse<?> copy(@PathVariable Long id) {
    return ApiResponse.ok(service.copy(id));
  }

  /** 草稿或明确撤回后才可删除，业务记录与投递同事务清理并保留请求审计。 */
  @DeleteMapping("/notifications/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  /** 收件箱只查询当前账号已发布且未过期的逐人投递，正文不在列表中返回。 */
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

  /** 未读计数与收件箱复用同一账号、撤回和过期条件，不能统计不可见通知。 */
  @GetMapping("/messages/unread")
  public ApiResponse<?> unread() {
    access.require("messages:view");
    return ApiResponse.ok(deliveries.count(service.visibleInbox(false, "")));
  }

  /** 消息详情通过投递编号核验当前收件人和有效通知，读取本身不隐式写入已读状态。 */
  @GetMapping("/messages/{id}")
  public ApiResponse<?> message(@PathVariable Long id) {
    return ApiResponse.ok(service.detail(id));
  }

  /** 逐条标记已读仅更新当前收件人首次阅读时间，重复调用保持幂等。 */
  @PostMapping("/messages/{id}/read")
  @Transactional
  public ApiResponse<?> read(@PathVariable Long id) {
    service.read(id);
    return ApiResponse.ok(null);
  }

  /** 批量已读只影响当前账号目前可见的未读消息，提交后通知其他已登录窗口刷新。 */
  @PostMapping("/messages/read-all")
  @Transactional
  public ApiResponse<?> readAll() {
    return ApiResponse.ok(service.readAll());
  }
}
