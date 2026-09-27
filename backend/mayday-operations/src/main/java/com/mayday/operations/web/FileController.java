package com.mayday.operations.web;

import com.mayday.common.*;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.security.AccessPolicy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 文件通过 Bearer 鉴权下载并强制附件响应，不公开磁盘路径，也不将上传内容当 HTML 执行。 */
@RestController
@RequestMapping("/api/operations/files")
@RequiredArgsConstructor
public class FileController {
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final AccessPolicy access;
  private final NotificationRepository notifications;
  private final List<FileUsage> businessReferences;

  @GetMapping
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("files:view");
    return ApiResponse.ok(
        PageResult.from(
            files.findAll(
                (r, q, c) ->
                    c.and(
                        access.has("files:all")
                            ? c.conjunction()
                            : c.equal(r.get("ownerId"), access.current().getId()),
                        SearchPredicates.contains(c, r.get("name"), keyword)),
                PageResult.request(page, size))));
  }

  private StoredFile find(Long id) {
    var f = files.findById(id).orElseThrow(() -> new BusinessException("文件不存在"));
    if (!access.has("files:all") && !Objects.equals(f.getOwnerId(), access.current().getId()))
      throw new org.springframework.security.access.AccessDeniedException("无权访问此文件");
    return f;
  }

  @PostMapping
  @Transactional
  public ApiResponse<?> upload(@RequestPart("file") MultipartFile upload)
      throws java.io.IOException {
    access.require("files:create");
    if (upload.isEmpty() || upload.getSize() > 10 * 1024 * 1024)
      throw new BusinessException("文件大小须为 1 字节到 10 MB");
    String name = Objects.toString(upload.getOriginalFilename(), "file").replace('\\', '/');
    name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "");
    if (name.isBlank() || name.length() > 255) throw new BusinessException("文件名无效");
    String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    if (!Set.of("pdf", "txt", "csv", "png", "jpg", "jpeg", "webp", "docx", "xlsx", "zip")
        .contains(ext)) throw new BusinessException("不支持此文件类型");
    var f = new StoredFile();
    f.setName(name);
    f.setContentType("application/octet-stream");
    f.setSize(upload.getSize());
    f.setOwnerId(access.current().getId());
    f.setOwnerName(access.current().getNickname());
    files.saveAndFlush(f);
    var p = new FilePayload();
    p.setId(f.getId());
    p.setData(upload.getBytes());
    payloads.save(p);
    return ApiResponse.ok(f);
  }

  @GetMapping("/{id}/download")
  @Transactional(readOnly = true)
  public ResponseEntity<byte[]> download(@PathVariable Long id) {
    access.require("files:download");
    var f = find(id);
    return ResponseEntity.ok()
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(f.getName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(payloads.findById(id).orElseThrow(() -> new BusinessException("文件正文不存在")).getData());
  }

  @DeleteMapping("/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    access.require("files:delete");
    var f = find(id);
    if (notifications.existsByAttachmentIdsContains(id)
        || businessReferences.stream().anyMatch(ref -> ref.referenced(id)))
      throw new BusinessException("文件被业务记录引用，不能删除");
    payloads.deleteById(id);
    payloads.flush();
    files.delete(f);
    return ApiResponse.ok(null);
  }
}
