package com.mayday.web;

import com.mayday.common.*;
import com.mayday.content.*;
import com.mayday.service.*;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 公开 DTO 只读取当前上线修订，编辑新稿、历史修订、内部内容、作者与部门 ID 均不进入匿名响应。 */
@RestController
@RequestMapping("/api/public")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PublicController {
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final EntryRepository entries;
  private final SettingService settingService;
  private final ContentAssets assets;

  @GetMapping("/site")
  public ApiResponse<?> site() {
    var s = settingService.publicValues();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", s.get("site.name"));
    out.put("description", s.get("site.description"));
    out.put("seoTitle", s.get("site.title"));
    out.put("keywords", s.get("site.keywords"));
    out.put("contact", s.get("site.contact"));
    out.put("phone", s.get("site.phone"));
    out.put("address", s.get("site.address"));
    out.put("copyright", s.get("site.copyright"));
    out.put("icp", s.get("site.icp"));
    out.put("theme", settingService.publicTheme());
    out.put(
        "categories",
        entries.findByKindOrderBySortOrderAscIdAsc("categories").stream()
            .filter(SystemEntry::isEnabled)
            .map(SystemEntry::getName)
            .toList());
    return ApiResponse.ok(out);
  }

  @GetMapping("/taxonomy")
  public ApiResponse<?> taxonomy() {
    Map<String, Object> out = new LinkedHashMap<>();
    for (String kind : List.of("categories", "tags"))
      out.put(
          kind,
          entries.findByKindOrderBySortOrderAscIdAsc(kind).stream()
              .filter(SystemEntry::isEnabled)
              .map(e -> Map.of("id", e.getId(), "name", e.getName()))
              .toList());
    return ApiResponse.ok(out);
  }

  private Map<String, Object> article(Notice n, boolean detail) {
    var r = revisions.findById(n.getLiveRevisionId()).orElseThrow();
    Map<String, Object> v = new LinkedHashMap<>();
    v.put("id", n.getId());
    v.put("title", r.getTitle());
    v.put("summary", r.getSummary());
    v.put("content", detail ? r.getContent() : null);
    v.put("categoryId", r.getCategoryId());
    v.put("category", entries.findById(r.getCategoryId()).map(SystemEntry::getName).orElse(""));
    v.put(
        "tags",
        entries.findAllById(r.getTagIds()).stream()
            .map(e -> Map.of("id", e.getId(), "name", e.getName()))
            .toList());
    v.put("authorName", n.getAuthorName());
    v.put("createdAt", n.getPublishedAt());
    v.put("viewCount", n.getViewCount());
    v.put("pinned", r.isPinned());
    v.put("recommended", r.isRecommended());
    v.put(
        "coverUrl", r.getCoverId() == null ? null : "/api/public/articles/" + n.getId() + "/cover");
    v.put("seoTitle", r.getSeoTitle());
    v.put("seoKeywords", r.getSeoKeywords());
    v.put("seoDescription", r.getSeoDescription());
    if (detail)
      v.put(
          "attachments",
          assets.records(r.getAttachmentIds()).stream()
              .map(
                  f ->
                      Map.of(
                          "id",
                          f.getId(),
                          "name",
                          f.getName(),
                          "size",
                          f.getSize(),
                          "url",
                          "/api/public/articles/" + n.getId() + "/files/" + f.getId()))
              .toList());
    return v;
  }

  @GetMapping("/articles")
  public ResponseEntity<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "") String category,
      @RequestParam(required = false) Long categoryId,
      @RequestParam(required = false) Long tagId,
      @RequestParam(required = false) Boolean recommended,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "9") int size) {
    var spec =
        ContentService.publiclyVisible()
            .and(
                (r, q, c) ->
                    c.and(
                        SearchPredicates.contains(c, r.get("liveRevision").get("title"), keyword),
                        categoryId == null
                            ? c.conjunction()
                            : c.equal(r.get("liveRevision").get("categoryId"), categoryId),
                        category.isBlank()
                            ? c.conjunction()
                            : c.equal(
                                r.get("liveRevision").get("categoryEntry").get("name"), category),
                        tagId == null
                            ? c.conjunction()
                            : c.isMember(tagId, r.get("liveRevision").get("tagIds")),
                        recommended == null
                            ? c.conjunction()
                            : c.equal(r.get("liveRevision").get("recommended"), recommended)));
    var request =
        PageRequest.of(
            Math.max(0, page - 1),
            Math.max(1, Math.min(100, size)),
            Sort.by(
                Sort.Order.desc("liveRevision.pinned"),
                Sort.Order.desc("liveRevision.sortOrder"),
                Sort.Order.desc("publishedAt"),
                Sort.Order.desc("id")));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            ApiResponse.ok(
                PageResult.from(notices.findAll(spec, request).map(n -> article(n, false)))));
  }

  @GetMapping("/articles/{id}")
  public ResponseEntity<?> detail(@PathVariable Long id) {
    var found =
        notices.findOne(
            ContentService.publiclyVisible().and((r, q, c) -> c.equal(r.get("id"), id)));
    if (found.isEmpty())
      return ResponseEntity.status(404)
          .cacheControl(CacheControl.noStore())
          .body(ApiResponse.error("内容不存在或尚未发布"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.ok(article(found.get(), true)));
  }

  /** 浏览次数为成功的详情进入上报次数，刷新计入，后台轮询不计入；客户端不能直接设置统计数字。 */
  @PostMapping("/articles/{id}/view")
  @Transactional
  public ResponseEntity<?> recordView(@PathVariable Long id) {
    var found =
        notices.findOne(
            ContentService.publiclyVisible().and((r, q, c) -> c.equal(r.get("id"), id)));
    if (found.isEmpty())
      return ResponseEntity.status(404)
          .cacheControl(CacheControl.noStore())
          .body(ApiResponse.error("内容不存在或尚未发布"));
    notices.incrementViews(id);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.ok(found.get().getViewCount() + 1));
  }
}
