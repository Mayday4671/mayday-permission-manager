package com.mayday.web;

import com.mayday.common.*;
import com.mayday.content.*;
import com.mayday.security.AccessPolicy;
import com.mayday.service.ContentService;
import com.mayday.web.ContentContracts.*;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 列表、详情、修订和回收站使用相同内容范围；业务状态与版本规则集中在 ContentService。 */
@RestController
@RequestMapping("/api/content/notices")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class NoticeController {
  private final NoticeRepository notices;
  private final ContentPublicationRepository publications;
  private final ContentService service;
  private final AccessPolicy access;

  @GetMapping
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean published,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long categoryId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("notices:view");
    var spec =
        access
            .<Notice>filter("notices", "authorId")
            .and(
                (r, q, c) ->
                    c.and(
                        c.isNull(r.get("deletedAt")),
                        SearchPredicates.contains(c, r.get("title"), keyword),
                        published == null
                            ? c.conjunction()
                            : c.equal(r.get("published"), published),
                        status == null || status.isBlank()
                            ? c.conjunction()
                            : c.equal(r.get("draftStatus"), status)));
    if (categoryId != null)
      spec =
          spec.and(
              (r, q, c) -> {
                var sub = q.subquery(Long.class);
                var revision = sub.from(ContentRevision.class);
                sub.select(revision.get("id"))
                    .where(c.equal(revision.get("categoryId"), categoryId));
                return r.get("draftRevisionId").in(sub);
              });
    return ApiResponse.ok(
        PageResult.from(notices.findAll(spec, PageResult.request(page, size)).map(service::view)));
  }

  @GetMapping("/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(service.view(service.managed(id, false)));
  }

  @GetMapping("/{id}/revisions")
  public ApiResponse<?> revisions(@PathVariable Long id) {
    return ApiResponse.ok(service.history(id));
  }

  @GetMapping("/{id}/publications")
  public ApiResponse<?> publications(
      @PathVariable Long id,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    service.managed(id, false);
    return ApiResponse.ok(
        PageResult.from(
            publications.findAll(
                (r, q, c) -> c.equal(r.get("noticeId"), id), PageResult.request(page, size))));
  }

  @PostMapping
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody Draft req) {
    return ApiResponse.ok(service.save(null, req));
  }

  @PutMapping("/{id}")
  @Transactional
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody Draft req) {
    return ApiResponse.ok(service.save(id, req));
  }

  @PostMapping("/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(@PathVariable Long id, @Valid @RequestBody Publish req) {
    return ApiResponse.ok(service.publish(id, req));
  }

  @PostMapping("/{id}/offline")
  @Transactional
  public ApiResponse<?> offline(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(service.offline(id, req.version()));
  }

  @DeleteMapping("/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  @GetMapping("/recycle")
  public ApiResponse<?> recycle(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("notices:view");
    return ApiResponse.ok(
        PageResult.from(
            notices
                .findAll(
                    access
                        .<Notice>filter("notices", "authorId")
                        .and(
                            (r, q, c) ->
                                c.and(
                                    c.isNotNull(r.get("deletedAt")),
                                    SearchPredicates.contains(c, r.get("title"), keyword))),
                    PageResult.request(page, size))
                .map(service::view)));
  }

  @PostMapping("/{id}/restore")
  @Transactional
  public ApiResponse<?> restore(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(service.restore(id, req.version()));
  }

  @DeleteMapping("/{id}/purge")
  @Transactional
  public ApiResponse<?> purge(@PathVariable Long id) {
    service.purge(id);
    return ApiResponse.ok(null);
  }
}
