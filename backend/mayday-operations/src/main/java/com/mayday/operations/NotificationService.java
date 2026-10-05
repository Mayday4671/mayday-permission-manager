package com.mayday.operations;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.RichText;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.model.Delivery;
import com.mayday.operations.model.Notification;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.realtime.RealtimeEvents;
import com.mayday.operations.repository.DeliveryRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 管理权限决定能操作哪条通知，用户数据范围决定能向谁投递，两者分别校验。 发布时冻结收件人，正文与投递同事务提交；失败整批回滚，安全重试不会重复投递。
 * 已发布正文不可原地修改；撤回和过期只影响接收端可见性，管理端保留阅读历史。
 */
@Service
@RequiredArgsConstructor
public class NotificationService {
  private final NotificationRepository notifications;
  private final DeliveryRepository deliveries;
  private final UserRepository users;
  private final EntryRepository entries;
  private final RoleRepository roles;
  private final StoredFileRepository files;
  private final AccessPolicy access;
  private final RealtimeEvents realtime;

  /** 发布前的可变通知契约；收件人、正文长度和附件归属均由后端验证。 */
  @Schema(name = "NotificationDraft")
  public record Draft(
      @NotBlank @Size(max = 160) String title,
      @Size(max = 500) String summary,
      @NotBlank @Size(max = 50000) String content,
      @NotNull @Pattern(regexp = "NOTICE|ANNOUNCEMENT|REMINDER") String type,
      @NotNull @Pattern(regexp = "ALL|DEPARTMENTS|ROLES|USERS") String recipientType,
      @NotNull @Size(max = 1000) Set<@NotNull Long> recipientIds,
      @NotNull @Size(max = 8) Set<@NotNull Long> attachmentIds,
      LocalDateTime expiresAt,
      Long version) {}

  /** 发布及撤回携带客户端最后读取的版本，不允许过期弹窗覆盖当前通知状态。 */
  @Schema(name = "NotificationVersion")
  public record Version(@NotNull Long version) {}

  /** 下拉选项只包含服务端已核验目标编号和显示标签，不携带账号联系方式。 */
  @Schema(
      name = "NotificationRecipientOption",
      requiredProperties = {"value", "label"})
  public record Option(Long value, String label) {}

  /** 发件管理详情保留目标和阅读统计；接收端必须使用只包含本人投递状态的独立契约。 */
  @Schema(name = "NotificationView")
  public record View(
      Long id,
      Long version,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      String title,
      String summary,
      String content,
      String type,
      String status,
      String recipientType,
      Set<Long> recipientIds,
      List<Option> recipientOptions,
      List<StoredFile> attachments,
      Long senderId,
      String senderName,
      LocalDateTime publishedAt,
      LocalDateTime expiresAt,
      long recipientCount,
      long readCount,
      String targetType,
      Long targetId) {}

  /** 单人投递列表摘要，编号是投递而非通知；首次阅读状态只属于当前收件人。 */
  public record Inbox(
      Long id,
      Long version,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      Long notificationId,
      String title,
      String summary,
      String type,
      String senderName,
      LocalDateTime publishedAt,
      LocalDateTime readAt) {}

  /** 收件详情携带已鉴权正文与业务标签，任意关联编号仍须业务接口重新授权。 */
  public record MessageDetail(
      Inbox delivery,
      String content,
      List<StoredFile> attachments,
      String targetType,
      Long targetId) {}

  /** 管理列表按发件人限制；全部管理权限只扩大通知范围，不扩大可发送的用户范围。 */
  public Specification<Notification> manageable() {
    return (r, q, c) ->
        access.has("notifications:all")
            ? c.conjunction()
            : c.equal(r.get("senderId"), access.current().getId());
  }

  private Notification managed(Long id, boolean lock) {
    access.require("notifications:view");
    var notification =
        (lock ? notifications.lockById(id) : notifications.findById(id))
            .orElseThrow(() -> new BusinessException("通知不存在"));
    if (!access.has("notifications:all")
        && !Objects.equals(notification.getSenderId(), access.current().getId()))
      throw new AccessDeniedException("不能管理其他人的通知");
    return notification;
  }

  /** 详情和投递名单共用管理范围，不能凭通知编号查看他人草稿。 */
  public Notification getManaged(Long id) {
    return managed(id, false);
  }

  /** 回显目标选择和统计；已失效的目标保留编号标签，不能静默替换成其他收件人。 */
  public View view(Notification notification) {
    List<Option> options =
        switch (notification.getRecipientType()) {
          case "USERS" ->
              users.findAllById(notification.getRecipientIds()).stream()
                  .map(u -> new Option(u.getId(), u.getNickname() + " · " + u.getUsername()))
                  .toList();
          case "DEPARTMENTS" ->
              entries.findAllById(notification.getRecipientIds()).stream()
                  .map(e -> new Option(e.getId(), e.getName()))
                  .toList();
          case "ROLES" ->
              roles.findAllById(notification.getRecipientIds()).stream()
                  .map(r -> new Option(r.getId(), r.getName()))
                  .toList();
          default -> List.of();
        };
    var labels = new ArrayList<>(options);
    for (Long id : notification.getRecipientIds())
      if (labels.stream().noneMatch(o -> o.value().equals(id)))
        labels.add(new Option(id, "已失效目标 #" + id));
    return new View(
        notification.getId(),
        notification.getVersion(),
        notification.getCreatedAt(),
        notification.getUpdatedAt(),
        notification.getTitle(),
        notification.getSummary(),
        notification.getContent(),
        notification.getType(),
        displayStatus(notification),
        notification.getRecipientType(),
        notification.getRecipientIds(),
        labels,
        files.findAllById(notification.getAttachmentIds()),
        notification.getSenderId(),
        notification.getSenderName(),
        notification.getPublishedAt(),
        notification.getExpiresAt(),
        deliveries.countByNotificationId(notification.getId()),
        deliveries.countByNotificationIdAndReadAtIsNotNull(notification.getId()),
        notification.getTargetType(),
        notification.getTargetId());
  }

  /** 过期为展示状态；原发布记录和首次阅读历史不因为过期而删除。 */
  public static String displayStatus(Notification notification) {
    return "PUBLISHED".equals(notification.getStatus())
            && notification.getExpiresAt() != null
            && !notification.getExpiresAt().isAfter(BusinessTime.now())
        ? "EXPIRED"
        : notification.getStatus();
  }

  /** 显示状态筛选与详情保持一致，过期筛选在数据库执行而不是分页后丢弃。 */
  public static Specification<Notification> state(String status) {
    return (r, q, c) -> {
      if (status == null || status.isBlank()) return c.conjunction();
      var now = BusinessTime.now();
      if ("EXPIRED".equals(status))
        return c.and(
            c.equal(r.get("status"), "PUBLISHED"), c.lessThanOrEqualTo(r.get("expiresAt"), now));
      if ("PUBLISHED".equals(status))
        return c.and(
            c.equal(r.get("status"), status),
            c.or(c.isNull(r.get("expiresAt")), c.greaterThan(r.get("expiresAt"), now)));
      if (!Set.of("DRAFT", "WITHDRAWN").contains(status)) throw new BusinessException("通知状态无效");
      return c.equal(r.get("status"), status);
    };
  }

  private void draftOnly(Notification notification) {
    if (!"DRAFT".equals(notification.getStatus())) throw new BusinessException("只有草稿可以编辑，请复制为新通知");
  }

  private void validateFiles(Set<Long> ids) {
    // 同一事务按编号升序锁住附件；回收操作不能在校验之后、关联保存之前抢先提交。
    var found =
        ids.stream()
            .sorted()
            .map(id -> files.lock(id).orElseThrow(() -> new BusinessException("附件不存在，请重新选择")))
            .toList();
    found.forEach(StoredFileContent::active);
    for (var file : found)
      if (!access.has("files:all") && !Objects.equals(file.getOwnerId(), access.current().getId()))
        throw new AccessDeniedException("不能关联其他人的文件");
  }

  /** 编辑仅限草稿并核验版本；附件必须存在且可由当前用户关联，正文统一清洗。 */
  @Transactional
  public View save(Long id, Draft request) {
    access.require(id == null ? "notifications:create" : "notifications:update");
    access.require("notifications:view");
    Notification notification = id == null ? new Notification() : managed(id, true);
    if (id != null) {
      draftOnly(notification);
      OperationSupport.version(notification, request.version());
    }
    if (request.expiresAt() != null && !request.expiresAt().isAfter(BusinessTime.now()))
      throw new BusinessException("过期时间必须晚于当前时间");
    if ("ALL".equals(request.recipientType()) && !request.recipientIds().isEmpty())
      throw new BusinessException("全部用户无需额外选择目标");
    if (!"ALL".equals(request.recipientType()) && request.recipientIds().isEmpty())
      throw new BusinessException("请选择接收范围");
    validateFiles(request.attachmentIds());
    notification.setTitle(request.title().trim());
    notification.setSummary(request.summary());
    notification.setContent(RichText.clean(request.content(), 50000));
    notification.setType(request.type());
    notification.setRecipientType(request.recipientType());
    notification.setRecipientIds(new HashSet<>(request.recipientIds()));
    notification.setAttachmentIds(new HashSet<>(request.attachmentIds()));
    notification.setExpiresAt(request.expiresAt());
    if (id == null) {
      notification.setSenderId(access.current().getId());
      notification.setSenderName(access.current().getNickname());
    }
    recipients(notification);
    return view(notifications.saveAndFlush(notification));
  }

  /** 部门与角色仅解析当前直接成员；不隐式包含下级部门，不静默丢弃越权目标。 */
  public List<SysUser> recipients(Notification notification) {
    access.require("users:view");
    Set<Long> ids = notification.getRecipientIds();
    Specification<SysUser> target;
    switch (notification.getRecipientType()) {
      case "ALL":
        if (!"ALL".equals(access.scope("users")))
          throw new AccessDeniedException("向全部用户发送需要全部用户数据范围");
        target = (r, q, c) -> c.isTrue(r.get("enabled"));
        break;
      case "USERS":
        var selected = users.findAllById(ids);
        if (selected.size() != ids.size() || selected.stream().anyMatch(u -> !u.isEnabled()))
          throw new BusinessException("收件人已停用或不存在");
        target = (r, q, c) -> r.get("id").in(ids);
        break;
      case "DEPARTMENTS":
        var depts = entries.findAllById(ids);
        if (depts.size() != ids.size()
            || depts.stream()
                .anyMatch(
                    delivery -> !delivery.isEnabled() || !"departments".equals(delivery.getKind())))
          throw new BusinessException("请选择有效部门");
        target = (r, q, c) -> c.and(c.isTrue(r.get("enabled")), r.get("departmentId").in(ids));
        break;
      case "ROLES":
        var selectedRoles = roles.findAllById(ids);
        if (selectedRoles.size() != ids.size()
            || selectedRoles.stream().anyMatch(r -> !r.isEnabled()))
          throw new BusinessException("请选择有效角色");
        target =
            (r, q, c) -> {
              q.distinct(true);
              return c.and(c.isTrue(r.get("enabled")), r.join("roles").get("id").in(ids));
            };
        break;
      default:
        throw new BusinessException("接收范围无效");
    }
    var resolved = users.findAll(target);
    if (resolved.isEmpty()) throw new BusinessException("接收范围内没有启用用户");
    for (var u : resolved) access.checkData("users", u.getId(), u.getDepartmentId());
    return resolved;
  }

  /** 发布时冻结收件人，通知与逐人投递同事务；重复点击已发布记录不创建第二批投递。 */
  @Transactional
  public View publish(Long id, Long version) {
    access.require("notifications:publish");
    var notification = managed(id, true);
    if ("PUBLISHED".equals(notification.getStatus())) return view(notification); // 超时重试，不重复生成投递。
    draftOnly(notification);
    OperationSupport.version(notification, version);
    if (notification.getExpiresAt() != null
        && !notification.getExpiresAt().isAfter(BusinessTime.now()))
      throw new BusinessException("通知已过期，请修改草稿");
    var recipients = recipients(notification);
    validateFiles(notification.getAttachmentIds());
    notification.setStatus("PUBLISHED");
    notification.setPublishedAt(BusinessTime.now());
    for (var u : recipients) {
      var delivery = new Delivery();
      delivery.setNotification(notification);
      delivery.setRecipientId(u.getId());
      delivery.setRecipientName(u.getNickname());
      deliveries.save(delivery);
    }
    notifications.flush();
    realtime.changed(recipients.stream().map(SysUser::getId).toList(), "messages");
    return view(notification);
  }

  /** 撤回只阻断后续正文访问并刷新收件端，不删除已读痕迹；旧附件地址同样重新鉴权。 */
  @Transactional
  public View withdraw(Long id, Long version) {
    access.require("notifications:withdraw");
    var notification = managed(id, true);
    if ("WITHDRAWN".equals(notification.getStatus())) return view(notification);
    if (!"PUBLISHED".equals(notification.getStatus())) throw new BusinessException("只有已发布通知可以撤回");
    OperationSupport.version(notification, version);
    notification.setStatus("WITHDRAWN");
    notification.setWithdrawnAt(BusinessTime.now());
    notifications.flush();
    realtime.changed(
        deliveries.findByNotificationId(id).stream().map(Delivery::getRecipientId).toList(),
        "messages");
    return view(notification);
  }

  /** 已发通知无法原地修改，复制重建草稿并重新验证附件归属后才可再次发布。 */
  @Transactional
  public View copy(Long id) {
    access.require("notifications:create");
    var old = managed(id, false);
    validateFiles(old.getAttachmentIds());
    var notification = new Notification();
    notification.setTitle(old.getTitle());
    notification.setSummary(old.getSummary());
    notification.setContent(old.getContent());
    notification.setType(old.getType());
    notification.setRecipientType(old.getRecipientType());
    notification.setRecipientIds(new HashSet<>(old.getRecipientIds()));
    notification.setAttachmentIds(new HashSet<>(old.getAttachmentIds()));
    notification.setSenderId(access.current().getId());
    notification.setSenderName(access.current().getNickname());
    return view(notifications.saveAndFlush(notification));
  }

  /** 发布记录须先明确撤回才能删除；删除草稿或撤回记录会一并删除投递，但保留操作审计。 */
  @Transactional
  public void delete(Long id) {
    access.require("notifications:delete");
    var notification = managed(id, true);
    if (!Set.of("DRAFT", "WITHDRAWN").contains(notification.getStatus()))
      throw new BusinessException("请先撤回通知再删除");
    deliveries.deleteByNotificationId(id);
    deliveries.flush();
    notifications.delete(notification);
  }

  /** 详情、未读计数与附件共用同一可见性条件，旧 URL 和缓存不构成访问授权。 */
  public Specification<Delivery> visibleInbox(Boolean read, String keyword) {
    return (r, q, c) ->
        c.and(
            c.equal(r.get("recipientId"), access.current().getId()),
            c.equal(r.get("notification").get("status"), "PUBLISHED"),
            c.or(
                c.isNull(r.get("notification").get("expiresAt")),
                c.greaterThan(r.get("notification").get("expiresAt"), BusinessTime.now())),
            SearchPredicates.contains(c, r.get("notification").get("title"), keyword),
            read == null
                ? c.conjunction()
                : read ? c.isNotNull(r.get("readAt")) : c.isNull(r.get("readAt")));
  }

  /** 消息编号属于收件投递而非通知编号，读取时校验当前账号、发布、撤回及过期条件。 */
  public Delivery ownMessage(Long id) {
    access.require("messages:view");
    return deliveries
        .findOne(visibleInbox(null, "").and((r, q, c) -> c.equal(r.get("id"), id)))
        .orElseThrow(() -> new AccessDeniedException("消息不存在或已撤回、过期"));
  }

  /** 列表只投递摘要和本人阅读状态，正文和附件内容走独立受保护详情接口。 */
  public Inbox inbox(Delivery delivery) {
    var notification = delivery.getNotification();
    return new Inbox(
        delivery.getId(),
        delivery.getVersion(),
        delivery.getCreatedAt(),
        delivery.getUpdatedAt(),
        notification.getId(),
        notification.getTitle(),
        notification.getSummary(),
        notification.getType(),
        notification.getSenderName(),
        notification.getPublishedAt(),
        delivery.getReadAt());
  }

  /** 明确查看详情后由前端另行标记已读，读取失败不能把未读消息误置为已读。 */
  public MessageDetail detail(Long id) {
    var delivery = ownMessage(id);
    var notification = delivery.getNotification();
    return new MessageDetail(
        inbox(delivery),
        notification.getContent(),
        files.findAllById(notification.getAttachmentIds()),
        notification.getTargetType(),
        notification.getTargetId());
  }

  /** SQL 附带当前接收者及未读条件，重复操作不会覆盖第一次阅读时间。 */
  @Transactional
  public void read(Long id) {
    ownMessage(id);
    deliveries.markRead(id, access.current().getId(), BusinessTime.now());
    realtime.changed(Set.of(access.current().getId()), "messages");
  }

  /** 仅批量更新本人当前可见消息，撤回/过期记录不被全读操作改写。 */
  @Transactional
  public int readAll() {
    access.require("messages:view");
    int updated = deliveries.markAllRead(access.current().getId(), BusinessTime.now());
    if (updated > 0) realtime.changed(Set.of(access.current().getId()), "messages");
    return updated;
  }

  /** 可选部门/角色必须其所有直接成员均在当前用户数据范围，不能借群发绕过范围控制。 */
  public List<Option> recipientOptions(String kind) {
    access.require("notifications:view");
    access.require("users:view");
    var allowedUsers =
        users.findAll(
            access.<SysUser>filter("users", "id").and((r, q, c) -> c.isTrue(r.get("enabled"))));
    Set<Long> allowed = new HashSet<>();
    allowedUsers.forEach(u -> allowed.add(u.getId()));
    if ("departments".equals(kind))
      return entries.findByKindOrderBySortOrderAscIdAsc("departments").stream()
          .filter(SystemEntry::isEnabled)
          .filter(
              e -> {
                var members =
                    users.findAll(
                        (r, q, c) ->
                            c.and(
                                c.isTrue(r.get("enabled")),
                                c.equal(r.get("departmentId"), e.getId())));
                return !members.isEmpty()
                    && members.stream().allMatch(u -> allowed.contains(u.getId()));
              })
          .map(e -> new Option(e.getId(), e.getName()))
          .toList();
    if ("roles".equals(kind))
      return roles.findAll().stream()
          .filter(SysRole::isEnabled)
          .filter(
              e -> {
                var members =
                    users.findAll(
                        (r, q, c) -> {
                          q.distinct(true);
                          return c.and(
                              c.isTrue(r.get("enabled")),
                              c.equal(r.join("roles").get("id"), e.getId()));
                        });
                return !members.isEmpty()
                    && members.stream().allMatch(u -> allowed.contains(u.getId()));
              })
          .map(e -> new Option(e.getId(), e.getName()))
          .toList();
    throw new BusinessException("选项类型无效");
  }
}
