package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.common.RichText;
import com.mayday.content.ContentPublication;
import com.mayday.content.ContentPublicationRepository;
import com.mayday.content.ContentRevision;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.content.Notice;
import com.mayday.content.NoticeRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.ContentContracts.Draft;
import com.mayday.web.ContentContracts.Publish;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 内容用例集中在应用服务：保存产生新修订，发布只切换已校验的版本指针，公开查询始终读取线上修订。 主记录行锁串行化保存、审核、发布、排期、删除，客户端版本号阻止旧弹窗覆盖。
 * 历史正文不可修改，审批授权绑定修订 ID；更新网站的强制审核参数也不能被旧排期绕过。
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ContentService {
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final ContentPublicationRepository publications;
  private final EntryRepository entries;
  private final UserRepository users;
  private final AccessPolicy access;
  private final ContentAssets assets;
  private final SettingService settings;
  private final ChangeAuditService changeAudit;
  private final PortalStructureService portal;
  private final com.mayday.operations.repository.FlowRequestRepository approvalRequests;

  /** 先验证内容查看权限与作者/部门范围，再选择普通读取或主记录行锁；所有管理用例复用此边界，行锁要求调用者处于事务。 */
  public Notice managed(Long id, boolean lock) {
    access.require("notices:view");
    var n =
        (lock ? notices.lockById(id) : notices.findById(id))
            .orElseThrow(() -> new BusinessException("内容不存在"));
    access.checkData("notices", n.getAuthorId(), n.getDepartmentId());
    return n;
  }

  /** 修订必须同时匹配内容ID，拒绝通过其他文章的修订ID越权读取正文；调用者应先授权对应主记录。 */
  public ContentRevision revision(Long id, Long noticeId) {
    return revisions
        .findById(id)
        .filter(r -> r.getNoticeId().equals(noticeId))
        .orElseThrow(() -> new BusinessException("内容修订不存在"));
  }

  private SystemEntry option(String kind, Long id) {
    return entries
        .findById(id)
        .filter(e -> kind.equals(e.getKind()) && e.isEnabled())
        .orElseThrow(
            () -> new BusinessException("请选择有效的" + ("categories".equals(kind) ? "分类" : "标签")));
  }

  private Long byName(String kind, String name) {
    return entries.findByKindOrderBySortOrderAscIdAsc(kind).stream()
        .filter(e -> e.isEnabled() && e.getName().equals(name))
        .map(SystemEntry::getId)
        .findFirst()
        .orElseThrow(() -> new BusinessException("分类或标签尚未登记，请先维护基础资料"));
  }

  /** 投影不可变修订与登记分类、标签及附件；仅在已授权的管理或发布上下文使用，文件元数据不含存储密钥。 */
  public Map<String, Object> revisionView(ContentRevision r) {
    Map<String, Object> v = new LinkedHashMap<>();
    v.put("revisionId", r.getId());
    v.put("revisionNumber", r.getRevisionNumber());
    v.put("title", r.getTitle());
    v.put("categoryId", r.getCategoryId());
    v.put("portalChannelId", r.getPortalChannelId());
    v.put(
        "category", entries.findById(r.getCategoryId()).map(SystemEntry::getName).orElse("已删除分类"));
    var tags = entries.findAllById(r.getTagIds());
    v.put("tagIds", r.getTagIds());
    v.put("tags", tags.stream().map(SystemEntry::getName).toList());
    v.put(
        "tagOptions",
        tags.stream().map(e -> Map.of("value", e.getId(), "label", e.getName())).toList());
    v.put("summary", r.getSummary());
    v.put("content", r.getContent());
    v.put("contentFormat", "HTML");
    v.put("visibility", r.getVisibility());
    v.put("coverId", r.getCoverId());
    v.put("cover", assets.record(r.getCoverId()));
    v.put("attachments", assets.records(r.getAttachmentIds()));
    v.put("attachmentIds", r.getAttachmentIds());
    v.put("sortOrder", r.getSortOrder());
    v.put("pinned", r.isPinned());
    v.put("recommended", r.isRecommended());
    v.put("seoTitle", r.getSeoTitle());
    v.put("seoKeywords", r.getSeoKeywords());
    v.put("seoDescription", r.getSeoDescription());
    v.put("approvalStatus", r.getApprovalStatus());
    v.put("approvalRequestId", r.getApprovalRequestId());
    v.put("editorName", r.getEditorName());
    v.put("revisedAt", r.getCreatedAt());
    return v;
  }

  /** 管理列表返回当前草稿和线上状态两个独立维度，线上正文仍由已发布修订决定；回收站和排期错误不会混同发布状态。 */
  public Map<String, Object> view(Notice n) {
    var v = revisionView(revision(n.getDraftRevisionId(), n.getId()));
    v.put("id", n.getId());
    v.put("version", n.getVersion());
    v.put("createdAt", n.getCreatedAt());
    v.put("updatedAt", n.getUpdatedAt());
    v.put("authorId", n.getAuthorId());
    v.put("authorName", n.getAuthorName());
    v.put("departmentId", n.getDepartmentId());
    v.put("published", online(n));
    v.put("status", n.getDeletedAt() != null ? "DELETED" : n.getDraftStatus());
    v.put("requiresApproval", n.isRequiresApproval());
    v.put("effectiveApprovalRequired", approvalRequired(n));
    v.put("liveRevisionId", n.getLiveRevisionId());
    // 首页选择器使用线上标题和栏目；未发布的新草稿不能改变可选公告或已编排内容的名称。
    var live = n.getLiveRevisionId() == null ? null : revision(n.getLiveRevisionId(), n.getId());
    v.put("liveTitle", live == null ? null : live.getTitle());
    v.put("livePortalChannelId", live == null ? null : live.getPortalChannelId());
    v.put(
        "publiclyVisible",
        online(n)
            && notices.exists(
                publiclyVisible()
                    .and((root, query, criteria) -> criteria.equal(root.get("id"), n.getId()))));
    v.put("publishedAt", n.getPublishedAt());
    v.put("liveOfflineAt", n.getLiveOfflineAt());
    v.put("deletedAt", n.getDeletedAt());
    v.put("scheduledPublishAt", n.getScheduledPublishAt());
    v.put("scheduledOfflineAt", n.getScheduledOfflineAt());
    v.put("scheduleError", n.getScheduleError());
    v.put("viewCount", n.getViewCount());
    return v;
  }

  /** 授权主记录后按修订号倒序读取完整历史；保存新草稿不会改写已发布正文或旧审批绑定的修订。 */
  public List<Map<String, Object>> history(Long id) {
    managed(id, false);
    return revisions.findByNoticeIdOrderByRevisionNumberDesc(id).stream()
        .map(this::revisionView)
        .toList();
  }

  /** 合并单篇审核要求与后台强制审核开关；发布和定时执行都重新读取，旧排期不能绕过后来开启的强制审核。 */
  public boolean approvalRequired(Notice n) {
    return n.isRequiresApproval()
        || Boolean.parseBoolean(settings.values().getOrDefault("content.requireApproval", "false"));
  }

  private void checkApproval(Notice n, ContentRevision r) {
    if (approvalRequired(n) && !"APPROVED".equals(r.getApprovalStatus()))
      throw new BusinessException("当前修订尚未通过发布审核");
  }

  private void active(Notice n) {
    if (n.getDeletedAt() != null) throw new BusinessException("请先从回收站恢复内容");
  }

  /** 计算当前有效上线状态，排除回收站、无线上修订和已到下线时间的记录；后台与公开入口复用一致时间语义。 */
  public static boolean online(Notice n) {
    return n.getDeletedAt() == null
        && n.isPublished()
        && n.getLiveRevisionId() != null
        && (n.getLiveOfflineAt() == null || n.getLiveOfflineAt().isAfter(LocalDateTime.now()));
  }

  /** 在数据库查询层只选择有效上线且PUBLIC的修订，避免先分页再过滤导致数量泄露或公开草稿正文。 */
  public static Specification<Notice> publiclyVisible() {
    return (r, q, c) ->
        c.and(
            c.isNull(r.get("deletedAt")),
            c.isTrue(r.get("published")),
            c.isNotNull(r.get("liveRevisionId")),
            c.equal(r.get("liveRevision").get("visibility"), "PUBLIC"),
            c.isTrue(r.get("liveRevision").get("categoryEntry").get("enabled")),
            c.isTrue(r.get("liveRevision").get("portalChannel").get("enabled")),
            c.or(
                c.isNull(r.get("liveOfflineAt")),
                c.greaterThan(r.get("liveOfflineAt"), LocalDateTime.now())));
  }

  /** 按动作权限保存新不可变修订，校验版本、分类、标签和附件归属并清理富文本；兼容旧published字段也必须独立发布授权。 */
  @Transactional
  public Map<String, Object> save(Long id, Draft req) {
    access.require(id == null ? "notices:create" : "notices:update");
    access.require("notices:view");
    Notice n = id == null ? new Notice() : managed(id, true);
    active(n);
    if (id != null) UserService.version(n, req.version());
    // 旧接口显式 published 仍执行发布授权；新编辑器省略它，允许编辑者撰写新草稿而不改线上版本。
    if (Boolean.TRUE.equals(req.published()) || (req.published() != null && n.isPublished()))
      access.require("notices:publish");
    if (Boolean.FALSE.equals(req.requiresApproval()) && n.isRequiresApproval())
      access.require("notices:publish");
    var category =
        option(
            "categories",
            req.categoryId() != null ? req.categoryId() : byName("categories", req.category()));
    Set<Long> tags = new HashSet<>(req.tagIds() == null ? Set.of() : req.tagIds());
    if (req.tagIds() == null && req.tags() != null)
      for (String tag : req.tags()) tags.add(byName("tags", tag));
    tags.forEach(tag -> option("tags", tag));
    var fileIds = req.attachmentIds() == null ? Set.<Long>of() : req.attachmentIds();
    assets.validate(fileIds, req.coverId());
    String html =
        "HTML".equals(req.contentFormat())
            ? RichText.clean(req.content(), 50000)
            : RichText.plain(req.content(), 50000);
    if (id == null) {
      n.setAuthorId(access.current().getId());
      n.setAuthorName(access.current().getNickname());
      n.setDepartmentId(access.current().getDepartmentId());
    }
    n.setTitle(req.title().trim());
    n.setCategory(category.getName());
    n.setSummary(req.summary());
    n.setContent(html);
    n.setTags(new HashSet<>(entries.findAllById(tags).stream().map(SystemEntry::getName).toList()));
    if (req.requiresApproval() != null) n.setRequiresApproval(req.requiresApproval());
    int number =
        n.getDraftRevisionId() == null
            ? 1
            : revision(n.getDraftRevisionId(), n.getId()).getRevisionNumber() + 1;
    notices.saveAndFlush(n);
    var r = new ContentRevision();
    r.setNoticeId(n.getId());
    r.setRevisionNumber(number);
    r.setTitle(n.getTitle());
    r.setCategoryId(category.getId());
    r.setPortalChannelId(portal.contentChannel(category.getId(), req.portalChannelId()));
    r.setSummary(req.summary());
    r.setContent(html);
    r.setVisibility(req.visibility() == null ? "PUBLIC" : req.visibility());
    r.setCoverId(req.coverId());
    r.setAttachmentIds(new HashSet<>(fileIds));
    r.setTagIds(tags);
    r.setSortOrder(req.sortOrder() == null ? 0 : req.sortOrder());
    r.setPinned(Boolean.TRUE.equals(req.pinned()));
    r.setRecommended(Boolean.TRUE.equals(req.recommended()));
    r.setSeoTitle(req.seoTitle());
    r.setSeoKeywords(req.seoKeywords());
    r.setSeoDescription(req.seoDescription());
    r.setEditorId(access.current().getId());
    r.setEditorName(access.current().getNickname());
    revisions.saveAndFlush(r);
    n.setDraftRevisionId(r.getId());
    n.setDraftStatus("DRAFT");
    clearSchedule(n);
    n.setScheduleError(null);
    if (Boolean.TRUE.equals(req.published())) {
      checkApproval(n, r);
      goLive(n, r, null, access.current().getNickname(), "直接发布");
    } else if (Boolean.FALSE.equals(req.published()) && n.isPublished()) takeOffline(n, "旧接口下线");
    notices.flush();
    return view(n);
  }

  /** 锁定主记录并只发布当前已审核修订；重复发布同一版本可幂等返回，定时上线保存操作人并在执行时重新验证权限。 */
  @Transactional
  public Map<String, Object> publish(Long id, Publish req) {
    access.require("notices:publish");
    var n = managed(id, true);
    active(n);
    if (Objects.equals(n.getLiveRevisionId(), req.revisionId())
        && online(n)
        && req.publishAt() == null
        && Objects.equals(req.offlineAt(), n.getLiveOfflineAt())) return view(n);
    UserService.version(n, req.version());
    if (!Objects.equals(n.getDraftRevisionId(), req.revisionId()))
      throw new BusinessException("只能发布当前修订，请刷新内容");
    var r = revision(req.revisionId(), id);
    checkApproval(n, r);
    option("categories", r.getCategoryId());
    portal.contentChannel(r.getCategoryId(), r.getPortalChannelId());
    for (Long tag : r.getTagIds()) option("tags", tag);
    LocalDateTime now = LocalDateTime.now(),
        start = req.publishAt() == null ? now : req.publishAt();
    if (req.offlineAt() != null && !req.offlineAt().isAfter(start))
      throw new BusinessException("下线时间必须晚于上线时间");
    if (req.publishAt() != null && !req.publishAt().isAfter(now))
      throw new BusinessException("定时上线时间必须晚于当前时间");
    n.setScheduleError(null);
    clearSchedule(n);
    if (req.publishAt() != null) {
      n.setScheduledRevisionId(r.getId());
      n.setScheduledPublishAt(start);
      n.setScheduledOfflineAt(req.offlineAt());
      n.setScheduledActorId(access.current().getId());
      n.setDraftStatus("SCHEDULED");
    } else goLive(n, r, req.offlineAt(), access.current().getNickname(), "直接发布");
    notices.flush();
    return view(n);
  }

  private void clearSchedule(Notice n) {
    n.setScheduledRevisionId(null);
    n.setScheduledPublishAt(null);
    n.setScheduledOfflineAt(null);
    n.setScheduledActorId(null);
  }

  /** 下线是单一内部操作，人工操作、删除和定时器都关闭同一发布记录。 */
  private void takeOffline(Notice n, String reason) {
    Map<String, Object> before = publicationSnapshot(n);
    var now = LocalDateTime.now();
    publications
        .findByNoticeIdAndOfflineAtIsNull(n.getId())
        .forEach(
            p -> {
              p.setOfflineAt(now);
              p.setReason(reason);
            });
    n.setPublished(false);
    n.setLiveRevisionId(null);
    n.setLiveRevision(null);
    n.setLiveOfflineAt(null);
    if ("PUBLISHED".equals(n.getDraftStatus())) n.setDraftStatus("OFFLINE");
    changeAudit.record("内容", n.getId(), reason, before, publicationSnapshot(n));
  }

  private void goLive(
      Notice n, ContentRevision r, LocalDateTime offlineAt, String operator, String reason) {
    option("categories", r.getCategoryId());
    portal.contentChannel(r.getCategoryId(), r.getPortalChannelId());
    takeOffline(n, "被新发布替换");
    n.setLiveRevisionId(r.getId());
    n.setLiveRevision(r);
    n.setPublished(true);
    n.setPublishedAt(LocalDateTime.now());
    n.setLiveOfflineAt(offlineAt);
    n.setDraftStatus("PUBLISHED");
    clearSchedule(n);
    var p = new ContentPublication();
    p.setNoticeId(n.getId());
    p.setRevisionId(r.getId());
    p.setPublishedAt(n.getPublishedAt());
    p.setOperatorName(operator);
    p.setReason(reason);
    publications.save(p);
    changeAudit.record("内容", n.getId(), reason, Map.of("线上修订ID", "—"), publicationSnapshot(n));
  }

  /** 记录发布版本与状态，不复制文章正文、附件或客户联系方式到日志。 */
  private static Map<String, Object> publicationSnapshot(Notice notice) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("内容标题", notice.getTitle());
    snapshot.put("前台展示", notice.isPublished());
    snapshot.put("线上修订ID", notice.getLiveRevisionId());
    snapshot.put("定时下线", notice.getLiveOfflineAt());
    return snapshot;
  }

  /** 人工下线要求发布权限、目标数据范围及当前版本；关闭线上发布记录与排期，不抹掉历史正文。 */
  @Transactional
  public Map<String, Object> offline(Long id, Long version) {
    access.require("notices:publish");
    var n = managed(id, true);
    UserService.version(n, version);
    active(n);
    takeOffline(n, "人工下线");
    clearSchedule(n);
    n.setDraftStatus("OFFLINE");
    notices.flush();
    return view(n);
  }

  /** 删除先移入回收站并取消排期，若仍在线或已排期额外要求发布权限；历史修订继续保留以便恢复和审计。 */
  @Transactional
  public void delete(Long id) {
    access.require("notices:delete");
    var n = managed(id, true);
    if (n.isPublished() || n.getScheduledRevisionId() != null) access.require("notices:publish");
    takeOffline(n, "移入回收站");
    clearSchedule(n);
    n.setDeletedAt(LocalDateTime.now());
  }

  /** 恢复只进入草稿状态，绝不自动重新上线；要求独立恢复权限及版本检查，防止旧弹窗改变回收站状态。 */
  @Transactional
  public Map<String, Object> restore(Long id, Long version) {
    access.require("notices:restore");
    var n = managed(id, true);
    UserService.version(n, version);
    if (n.getDeletedAt() == null) throw new BusinessException("内容不在回收站");
    n.setDeletedAt(null);
    n.setDraftStatus("DRAFT");
    n.setPublished(false);
    n.setLiveRevisionId(null);
    clearSchedule(n);
    notices.flush();
    return view(n);
  }

  /** 仅彻底删除回收站中且没有审批历史引用的内容，独立purge权限保护不可逆动作；关联发布和修订先于主记录清理。 */
  @Transactional
  public void purge(Long id) {
    access.require("notices:purge");
    var n = managed(id, true);
    if (n.getDeletedAt() == null) throw new BusinessException("请先移入回收站");
    if (approvalRequests.existsByBusinessTypeAndBusinessId("CONTENT", id))
      throw new BusinessException("内容仍被审批历史引用，保留在回收站以便审计");
    publications.deleteByNoticeId(id);
    publications.flush();
    revisions.deleteByNoticeId(id);
    revisions.flush();
    notices.delete(n);
  }

  /** 每条排期独立事务并锁定主记录。多实例同时扫描只会有一个实例真正产生新发布记录。 */
  @Transactional
  public void applyDue(Long id) {
    var n = notices.lockById(id).orElse(null);
    if (n == null || n.getDeletedAt() != null) return;
    var now = LocalDateTime.now();
    if (n.isPublished() && n.getLiveOfflineAt() != null && !n.getLiveOfflineAt().isAfter(now))
      takeOffline(n, "定时下线");
    if (n.getScheduledPublishAt() == null || n.getScheduledPublishAt().isAfter(now)) return;
    var actor = users.findById(n.getScheduledActorId()).orElse(null);
    try {
      if (actor == null
          || !access.hasFor(actor, "notices:publish")
          || !access.hasFor(actor, "notices:view")
          || !access.containsFor(actor, "notices", n.getAuthorId(), n.getDepartmentId()))
        throw new BusinessException("原排期操作人的权限已失效，请重新排期");
      var r = revision(n.getScheduledRevisionId(), id);
      checkApproval(n, r);
      option("categories", r.getCategoryId());
      for (Long tag : r.getTagIds()) option("tags", tag);
      if (n.getScheduledOfflineAt() != null && !n.getScheduledOfflineAt().isAfter(now))
        throw new BusinessException("排期有效窗口已结束，请重新排期");
      goLive(n, r, n.getScheduledOfflineAt(), actor.getNickname(), "定时上线");
      n.setScheduleError(null);
    } catch (BusinessException error) {
      clearSchedule(n);
      n.setDraftStatus("DRAFT");
      n.setScheduleError(error.getMessage());
    }
  }
}
