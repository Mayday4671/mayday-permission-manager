package com.mayday.bulk;

import com.mayday.common.ApiResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 批量接口只接受注册资源、CSV 文件与白名单筛选；权限由资源适配器服务端再验证。 */
@RestController
@RequestMapping("/api/bulk")
@RequiredArgsConstructor
public class BulkController {
  private final BulkService service;

  /** 模板属于导入动作，不能通过猜测资源地址获取不具备写权限的字段配置。 */
  @GetMapping(value = "/{resource}/template", produces = "text/csv;charset=UTF-8")
  public ResponseEntity<String> template(@PathVariable String resource) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(resource + "-template.csv", StandardCharsets.UTF_8)
                .build()
                .toString())
        .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
        .body(service.template(resource));
  }

  /** 有界读取上传文件，仅返回逐行安全预览；服务端尚未创建任何业务记录。 */
  @PostMapping(value = "/{resource}/import/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<BulkContracts.ImportPreview> preview(
      @PathVariable String resource, @RequestParam("file") MultipartFile file) throws IOException {
    return ApiResponse.ok(service.preview(resource, bytes(file)));
  }

  /** 提交时再次校验权限和内容；幂等标识隔离网络重试，任一行失败整批回滚。 */
  @PostMapping(value = "/{resource}/import/commit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<BulkContracts.ImportResult> commit(
      @PathVariable String resource,
      @RequestParam("file") MultipartFile file,
      @RequestParam String idempotencyKey)
      throws IOException {
    return ApiResponse.ok(service.commit(resource, bytes(file), idempotencyKey));
  }

  /** 当前登录人创建导出作业，后台按该人的有效数据范围和字段权限逐页生成文件。 */
  @PostMapping("/{resource}/exports")
  public ApiResponse<BulkContracts.JobView> export(
      @PathVariable String resource,
      @Valid @RequestBody BulkContracts.ExportFilter filter,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ApiResponse.ok(service.export(resource, filter, idempotencyKey));
  }

  /** 最近作业列表由服务器固定按本人过滤，不接受客户端指定 ownerId。 */
  @GetMapping("/jobs")
  public ApiResponse<List<BulkContracts.JobView>> list() {
    return ApiResponse.ok(service.list());
  }

  /** 猜测作业 ID 也必须通过本人归属检查，仅公开进度和脱敏失败说明。 */
  @GetMapping("/jobs/{id}")
  public ApiResponse<BulkContracts.JobView> view(@PathVariable Long id) {
    return ApiResponse.ok(service.view(id));
  }

  /** 本人取消活跃作业立即撤销执行租约，不允许取消他人作业或覆盖已完成结果。 */
  @PostMapping("/jobs/{id}/cancel")
  public ApiResponse<BulkContracts.JobView> cancel(@PathVariable Long id) {
    return ApiResponse.ok(service.cancel(id));
  }

  /** 本人明确重试失败或取消的导出，再次检查原授权指纹和并行额度。 */
  @PostMapping("/jobs/{id}/retry")
  public ApiResponse<BulkContracts.JobView> retry(@PathVariable Long id) {
    return ApiResponse.ok(service.retry(id));
  }

  /** 正文流式下载，不把大文件重新加载为 byte[]，不暴露物理存储路径。 */
  @GetMapping(value = "/jobs/{id}/download", produces = "text/csv;charset=UTF-8")
  public ResponseEntity<FileSystemResource> download(@PathVariable Long id) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(service.downloadName(id), StandardCharsets.UTF_8)
                .build()
                .toString())
        .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
        .body(service.download(id));
  }

  private byte[] bytes(MultipartFile file) throws IOException {
    if (file.isEmpty() || file.getSize() > CsvCodec.MAX_IMPORT_BYTES)
      throw new com.mayday.common.BusinessException("导入文件须为 1 字节到 2 MB");
    return file.getBytes();
  }
}
