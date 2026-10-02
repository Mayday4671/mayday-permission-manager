package com.mayday.crawler;

import com.mayday.common.*;
import com.mayday.operations.repository.*;
import com.mayday.security.AccessPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Semaphore;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 权限、所有权和文件关联均在服务器验证；浏览器传来的 ownerId、fileId 或地址不作为授权依据。 */
@RestController
@RequestMapping("/api/crawler/tasks")
@RequiredArgsConstructor
public class CrawlController {
  private final CrawlTaskRepository tasks;
  private final CrawlItemRepository items;
  private final CrawlStore store;
  private final AccessPolicy access;
  private final WebFetcher fetcher;
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final CrawlArticles articles;
  private final Semaphore previews = new Semaphore(2);

  public record Edit(
      @NotBlank @Size(max = 100) String name, @NotNull CrawlRules rules, Long version) {}

  public record Version(@NotNull Long version) {}

  @GetMapping
  @Transactional(readOnly = true)
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("crawler:view");
    return ApiResponse.ok(
        PageResult.from(
            tasks.findAll(
                (r, q, c) ->
                    c.and(
                        c.isFalse(r.get("archived")),
                        access.has("crawler:all")
                            ? c.conjunction()
                            : c.equal(r.get("ownerId"), access.current().getId()),
                        SearchPredicates.contains(c, r.get("name"), keyword),
                        status == null ? c.conjunction() : c.equal(r.get("status"), status)),
                PageResult.request(page, size))));
  }

  @GetMapping("/{id}")
  @Transactional(readOnly = true)
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(store.configuration(id, false));
  }

  @PostMapping
  public ApiResponse<?> create(@Valid @RequestBody Edit req) {
    return ApiResponse.ok(store.save(null, req.name(), req.rules(), null));
  }

  @PutMapping("/{id}")
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody Edit req) {
    return ApiResponse.ok(store.save(id, req.name(), req.rules(), req.version()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<?> delete(@PathVariable Long id) {
    store.delete(id);
    return ApiResponse.ok(null);
  }

  @PostMapping("/{id}/start")
  public ApiResponse<?> start(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.start(id, req.version(), false));
  }

  @PostMapping("/{id}/retry")
  public ApiResponse<?> retry(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.start(id, req.version(), true));
  }

  @PostMapping("/{id}/stop")
  public ApiResponse<?> stop(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.stop(id, req.version()));
  }

  @GetMapping("/{id}/items")
  @Transactional(readOnly = true)
  public ApiResponse<?> items(
      @PathVariable Long id,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    store.configuration(id, false);
    return ApiResponse.ok(
        PageResult.from(
            items.findAll(
                (r, q, c) ->
                    c.and(
                        c.equal(r.get("taskId"), id),
                        kind == null ? c.conjunction() : c.equal(r.get("kind"), kind),
                        status == null ? c.conjunction() : c.equal(r.get("status"), status)),
                PageResult.request(page, size))));
  }

  @PostMapping("/preview")
  public ApiResponse<?> preview(@RequestBody CrawlRules rules) throws Exception {
    access.require("crawler:view");
    access.require("crawler:run");
    rules.validate();
    if (!previews.tryAcquire()) throw new BusinessException("规则预览正在处理其他请求，请稍后重试");
    try {
      var response = fetcher.fetch(rules.entryUrl(), rules, false);
      var result = PageExtractor.extract(response, rules, false, 0, rules.entryUrl());
      var preview = new LinkedHashMap<String, Object>();
      preview.put("title", result.title());
      preview.put("images", result.images().stream().limit(10).toList());
      preview.put("details", result.details().stream().limit(10).toList());
      preview.put("pages", result.pages().stream().limit(10).toList());
      preview.put("article", result.article());
      return ApiResponse.ok(preview);
    } catch (BusinessException e) {
      throw e;
    } catch (Exception e) {
      throw new BusinessException("无法读取网页，请检查地址、规则或网站是否允许访问");
    } finally {
      previews.release();
    }
  }

  /** 默认卡片视图跨任务浏览，文章服务在数据库查询内执行与任务列表相同的所有权限制。 */
  @GetMapping("/articles")
  @Transactional(readOnly = true)
  public ApiResponse<?> articleCards(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "24") int size) {
    return ApiResponse.ok(articles.list(null, keyword, page, size));
  }

  @GetMapping("/{id}/articles")
  @Transactional(readOnly = true)
  public ApiResponse<?> articles(
      @PathVariable Long id,
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "12") int size) {
    store.accessible(id, false);
    return ApiResponse.ok(articles.list(id, keyword, page, size));
  }

  @GetMapping("/{id}/articles/{articleId}")
  @Transactional(readOnly = true)
  public ApiResponse<?> article(@PathVariable Long id, @PathVariable Long articleId) {
    store.accessible(id, false);
    return ApiResponse.ok(articles.detail(id, articleId));
  }

  @GetMapping("/{id}/items/{itemId}/image")
  @Transactional(readOnly = true)
  public ResponseEntity<byte[]> image(
      @PathVariable Long id,
      @PathVariable Long itemId,
      @RequestParam(defaultValue = "false") boolean download) {
    access.require("crawler:download");
    store.accessible(id, false);
    var item =
        items
            .findById(itemId)
            .filter(
                i ->
                    i.getTaskId().equals(id)
                        && i.getFileId() != null
                        && Set.of("SUCCESS", "DUPLICATE").contains(i.getStatus()))
            .orElseThrow(() -> new BusinessException("图片不存在或尚未采集完成"));
    var file = files.findById(item.getFileId()).orElseThrow(() -> new BusinessException("文件不存在"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            (download ? ContentDisposition.attachment() : ContentDisposition.inline())
                .filename(file.getName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .contentType(MediaType.parseMediaType(file.getContentType()))
        .body(
            payloads
                .findById(file.getId())
                .orElseThrow(() -> new BusinessException("文件正文不存在"))
                .getData());
  }
}
