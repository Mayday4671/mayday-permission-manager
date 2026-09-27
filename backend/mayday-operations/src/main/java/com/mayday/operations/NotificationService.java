package com.mayday.operations;

import com.mayday.common.*;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.*;
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

  public record Version(@NotNull Long version) {}

  public record Option(Long value, String label) {}

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

  public record MessageDetail(
      Inbox delivery,
      String content,
      List<StoredFile> attachments,
      String targetType,
      Long targetId) {}

  public Specification<Notification> manageable() {
    return (r, q, c) ->
        access.has("notifications:all")
            ? c.conjunction()
            : c.equal(r.get("senderId"), access.current().getId());
  }

  private Notification managed(Long id, boolean lock) {
    access.require("notifications:view");
    var n =
        (lock ? notifications.lockById(id) : notifications.findById(id))
            .orElseThrow(() -> new BusinessException("通知不存在"));
    if (!access.has("notifications:all")
        && !Objects.equals(n.getSenderId(), access.current().getId()))
      throw new AccessDeniedException("不能管理其他人的通知");
    return n;
  }

  public Notification getManaged(Long id) {
    return managed(id, false);
  }

  public View view(Notification n) {
    List<Option> options =
        switch (n.getRecipientType()) {
          case "USERS" ->
              users.findAllById(n.getRecipientIds()).stream()
                  .map(u -> new Option(u.getId(), u.getNickname() + " · " + u.getUsername()))
                  .toList();
          case "DEPARTMENTS" ->
              entries.findAllById(n.getRecipientIds()).stream()
                  .map(e -> new Option(e.getId(), e.getName()))
                  .toList();
          case "ROLES" ->
              roles.findAllById(n.getRecipientIds()).stream()
                  .map(r -> new Option(r.getId(), r.getName()))
                  .toList();
          default -> List.of();
        };
    var labels = new ArrayList<>(options);
    for (Long id : n.getRecipientIds())
      if (labels.stream().noneMatch(o -> o.value().equals(id)))
        labels.add(new Option(id, "已失效目标 #" + id));
    return new View(
        n.getId(),
        n.getVersion(),
        n.getCreatedAt(),
        n.getUpdatedAt(),
        n.getTitle(),
        n.getSummary(),
        n.getContent(),
        n.getType(),
        displayStatus(n),
        n.getRecipientType(),
        n.getRecipientIds(),
        labels,
        files.findAllById(n.getAttachmentIds()),
        n.getSenderId(),
        n.getSenderName(),
        n.getPublishedAt(),
        n.getExpiresAt(),
        deliveries.countByNotificationId(n.getId()),
        deliveries.countByNotificationIdAndReadAtIsNotNull(n.getId()),
        n.getTargetType(),
        n.getTargetId());
  }

  public static String displayStatus(Notification n) {
    return "PUBLISHED".equals(n.getStatus())
            && n.getExpiresAt() != null
            && !n.getExpiresAt().isAfter(LocalDateTime.now())
        ? "EXPIRED"
        : n.getStatus();
  }

  public static Specification<Notification> state(String status) {
    return (r, q, c) -> {
      if (status == null || status.isBlank()) return c.conjunction();
      var now = LocalDateTime.now();
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

  private void draftOnly(Notification n) {
    if (!"DRAFT".equals(n.getStatus())) throw new BusinessException("只有草稿可以编辑，请复制为新通知");
  }

  private void validateFiles(Set<Long> ids) {
    var found = files.findAllById(ids);
    if (found.size() != ids.size()) throw new BusinessException("附件不存在，请重新选择");
    for (var f : found)
      if (!access.has("files:all") && !Objects.equals(f.getOwnerId(), access.current().getId()))
        throw new AccessDeniedException("不能关联其他人的文件");
  }

  @Transactional
  public View save(Long id, Draft request) {
    access.require(id == null ? "notifications:create" : "notifications:update");
    access.require("notifications:view");
    Notification n = id == null ? new Notification() : managed(id, true);
    if (id != null) {
      draftOnly(n);
      OperationSupport.version(n, request.version());
    }
    if (request.expiresAt() != null && !request.expiresAt().isAfter(LocalDateTime.now()))
      throw new BusinessException("过期时间必须晚于当前时间");
    if ("ALL".equals(request.recipientType()) && !request.recipientIds().isEmpty())
      throw new BusinessException("全部用户无需额外选择目标");
    if (!"ALL".equals(request.recipientType()) && request.recipientIds().isEmpty())
      throw new BusinessException("请选择接收范围");
    validateFiles(request.attachmentIds());
    n.setTitle(request.title().trim());
    n.setSummary(request.summary());
    n.setContent(RichText.clean(request.content(), 50000));
    n.setType(request.type());
    n.setRecipientType(request.recipientType());
    n.setRecipientIds(new HashSet<>(request.recipientIds()));
    n.setAttachmentIds(new HashSet<>(request.attachmentIds()));
    n.setExpiresAt(request.expiresAt());
    if (id == null) {
      n.setSenderId(access.current().getId());
      n.setSenderName(access.current().getNickname());
    }
    recipients(n);
    return view(notifications.saveAndFlush(n));
  }

  /** 部门与角色仅解析当前直接成员；不隐式包含下级部门，不静默丢弃越权目标。 */
  public List<SysUser> recipients(Notification n) {
    access.require("users:view");
    Set<Long> ids = n.getRecipientIds();
    Specification<SysUser> target;
    switch (n.getRecipientType()) {
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
            || depts.stream().anyMatch(d -> !d.isEnabled() || !"departments".equals(d.getKind())))
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

  @Transactional
  public View publish(Long id, Long version) {
    access.require("notifications:publish");
    var n = managed(id, true);
    if ("PUBLISHED".equals(n.getStatus())) return view(n); // 超时重试，不重复生成投递。
    draftOnly(n);
    OperationSupport.version(n, version);
    if (n.getExpiresAt() != null && !n.getExpiresAt().isAfter(LocalDateTime.now()))
      throw new BusinessException("通知已过期，请修改草稿");
    var recipients = recipients(n);
    validateFiles(n.getAttachmentIds());
    n.setStatus("PUBLISHED");
    n.setPublishedAt(LocalDateTime.now());
    for (var u : recipients) {
      var d = new Delivery();
      d.setNotification(n);
      d.setRecipientId(u.getId());
      d.setRecipientName(u.getNickname());
      deliveries.save(d);
    }
    notifications.flush();
    return view(n);
  }

  @Transactional
  public View withdraw(Long id, Long version) {
    access.require("notifications:withdraw");
    var n = managed(id, true);
    if ("WITHDRAWN".equals(n.getStatus())) return view(n);
    if (!"PUBLISHED".equals(n.getStatus())) throw new BusinessException("只有已发布通知可以撤回");
    OperationSupport.version(n, version);
    n.setStatus("WITHDRAWN");
    n.setWithdrawnAt(LocalDateTime.now());
    notifications.flush();
    return view(n);
  }

  @Transactional
  public View copy(Long id) {
    access.require("notifications:create");
    var old = managed(id, false);
    validateFiles(old.getAttachmentIds());
    var n = new Notification();
    n.setTitle(old.getTitle());
    n.setSummary(old.getSummary());
    n.setContent(old.getContent());
    n.setType(old.getType());
    n.setRecipientType(old.getRecipientType());
    n.setRecipientIds(new HashSet<>(old.getRecipientIds()));
    n.setAttachmentIds(new HashSet<>(old.getAttachmentIds()));
    n.setSenderId(access.current().getId());
    n.setSenderName(access.current().getNickname());
    return view(notifications.saveAndFlush(n));
  }

  /** 发布记录须先明确撤回才能删除；删除草稿或撤回记录会一并删除投递，但保留操作审计。 */
  @Transactional
  public void delete(Long id) {
    access.require("notifications:delete");
    var n = managed(id, true);
    if (!Set.of("DRAFT", "WITHDRAWN").contains(n.getStatus()))
      throw new BusinessException("请先撤回通知再删除");
    deliveries.deleteByNotificationId(id);
    deliveries.flush();
    notifications.delete(n);
  }

  /** 详情、未读计数与附件共用同一可见性条件，旧 URL 和缓存不构成访问授权。 */
  public Specification<Delivery> visibleInbox(Boolean read, String keyword) {
    return (r, q, c) ->
        c.and(
            c.equal(r.get("recipientId"), access.current().getId()),
            c.equal(r.get("notification").get("status"), "PUBLISHED"),
            c.or(
                c.isNull(r.get("notification").get("expiresAt")),
                c.greaterThan(r.get("notification").get("expiresAt"), LocalDateTime.now())),
            SearchPredicates.contains(c, r.get("notification").get("title"), keyword),
            read == null
                ? c.conjunction()
                : read ? c.isNotNull(r.get("readAt")) : c.isNull(r.get("readAt")));
  }

  public Delivery ownMessage(Long id) {
    access.require("messages:view");
    return deliveries
        .findOne(visibleInbox(null, "").and((r, q, c) -> c.equal(r.get("id"), id)))
        .orElseThrow(() -> new AccessDeniedException("消息不存在或已撤回、过期"));
  }

  public Inbox inbox(Delivery d) {
    var n = d.getNotification();
    return new Inbox(
        d.getId(),
        d.getVersion(),
        d.getCreatedAt(),
        d.getUpdatedAt(),
        n.getId(),
        n.getTitle(),
        n.getSummary(),
        n.getType(),
        n.getSenderName(),
        n.getPublishedAt(),
        d.getReadAt());
  }

  public MessageDetail detail(Long id) {
    var d = ownMessage(id);
    var n = d.getNotification();
    return new MessageDetail(
        inbox(d),
        n.getContent(),
        files.findAllById(n.getAttachmentIds()),
        n.getTargetType(),
        n.getTargetId());
  }

  @Transactional
  public void read(Long id) {
    ownMessage(id);
    deliveries.markRead(id, access.current().getId(), LocalDateTime.now());
  }

  @Transactional
  public int readAll() {
    access.require("messages:view");
    return deliveries.markAllRead(access.current().getId(), LocalDateTime.now());
  }

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
