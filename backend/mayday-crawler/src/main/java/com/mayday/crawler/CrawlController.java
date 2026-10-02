package com.mayday.crawler;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.repository.FilePayloadRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.security.AccessPolicy;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.concurrent.Semaphore;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

  /** 配置请求不接受所有者或执行状态，服务端从当前身份建立所有者并验证完整采集规则。 */
  @Schema(name = "CrawlerConfigEdit")
  public record Edit(
      @NotBlank @Size(max = 100) String name, @NotNull CrawlRules rules, Long version) {}

  /** 操作携带最近读取的版本，避免浏览器旧页面覆盖另一位管理员已执行的状态变化。 */
  @Schema(name = "CrawlerConfigVersion")
  public record Version(@NotNull Long version) {}

  /** 配置列表排除已归档记录，在 SQL 先限制所有者，再执行关键词、状态与分页统计。 */
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

  /** 读取配置必须保留原所有者边界；配置已删除时不返回旧的可编辑规则。 */
  @GetMapping("/{id}")
  @Transactional(readOnly = true)
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(store.configuration(id, false));
  }

  /** 新配置只接受经过服务端规则校验的草稿，不能随请求指定其他账号作为所有者。 */
  @PostMapping
  public ApiResponse<?> create(@Valid @RequestBody Edit req) {
    return ApiResponse.ok(store.save(null, req.name(), req.rules(), null));
  }

  /** 编辑只允许未执行的配置，服务层锁定任务并核对版本。 */
  @PutMapping("/{id}")
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody Edit req) {
    return ApiResponse.ok(store.save(id, req.name(), req.rules(), req.version()));
  }

  /** 删除配置与数据分离，有文章时仅归档，执行中的配置须先停止。 */
  @DeleteMapping("/{id}")
  public ApiResponse<?> delete(@PathVariable Long id) {
    store.delete(id);
    return ApiResponse.ok(null);
  }

  /** 启动同时检查采集执行权与文件创建权，以当前操作人记录实际执行身份。 */
  @PostMapping("/{id}/start")
  public ApiResponse<?> start(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.start(id, req.version(), false));
  }

  /** 只重新排队失败记录，已经保存的正文和图片不重复下载或累计。 */
  @PostMapping("/{id}/retry")
  public ApiResponse<?> retry(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.start(id, req.version(), true));
  }

  /** 停止在数据库撤销执行租约，网络中尚未返回的请求不能继续保存结果。 */
  @PostMapping("/{id}/stop")
  public ApiResponse<?> stop(@PathVariable Long id, @Valid @RequestBody Version req) {
    return ApiResponse.ok(store.stop(id, req.version()));
  }

  /** 执行记录按原任务授权分页，不允许通过指定条目类型或状态扩大数据范围。 */
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

  /** 规则预览须有执行权，每次只请求入口一页并受并发额度限制，不保存配置或采集结果。 */
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

  /** 读取指定来源配置的文章，配置归档后数据仍可按原所有者权限浏览。 */
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

  /** 文章编号必须属于已授权的任务，详情正文和图片引用受字符预算及状态校验。 */
  @GetMapping("/{id}/articles/{articleId}")
  @Transactional(readOnly = true)
  public ApiResponse<?> article(@PathVariable Long id, @PathVariable Long articleId) {
    store.accessible(id, false);
    return ApiResponse.ok(articles.detail(id, articleId));
  }

  /** 图片读取需要独立下载权，且条目必须属于当前任务并已入库，不能猜文件编号越权。 */
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
