package com.mayday.web;

import com.mayday.common.*;
import com.mayday.content.*;
import com.mayday.operations.repository.*;
import com.mayday.service.*;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 文件地址不含令牌，公开封面/附件每次核对文章当前线上版本；下架、替换版本和删除后旧地址立即失效。 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ContentFileController {
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final ContentService content;
  private final ContentAssets assets;
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final com.mayday.operations.workflow.WorkflowEngine approvals;

  private ResponseEntity<?> missing() {
    return ResponseEntity.status(404)
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.error("文件不存在或内容未公开"));
  }

  @GetMapping("/public/articles/{id}/cover")
  public ResponseEntity<?> cover(@PathVariable Long id) {
    return publicFile(id, null, true);
  }

  @GetMapping("/public/articles/{id}/files/{fileId}")
  public ResponseEntity<?> attachment(@PathVariable Long id, @PathVariable Long fileId) {
    return publicFile(id, fileId, false);
  }

  private ResponseEntity<?> publicFile(Long id, Long fileId, boolean image) {
    var found =
        notices.findOne(
            ContentService.publiclyVisible().and((r, q, c) -> c.equal(r.get("id"), id)));
    if (found.isEmpty()) return missing();
    var r = revisions.findById(found.get().getLiveRevisionId()).orElseThrow();
    if (image) fileId = r.getCoverId();
    else if (!r.getAttachmentIds().contains(fileId)) return missing();
    return fileId == null ? missing() : download(fileId, image);
  }

  @GetMapping("/content/notices/{id}/revisions/{revisionId}/files/{fileId}")
  public ResponseEntity<?> managed(
      @PathVariable Long id,
      @PathVariable Long revisionId,
      @PathVariable Long fileId,
      @RequestParam(defaultValue = "false") boolean image) {
    content.managed(id, false);
    var r = content.revision(revisionId, id);
    if (image ? !fileId.equals(r.getCoverId()) : !r.getAttachmentIds().contains(fileId))
      return missing();
    return download(fileId, image);
  }

  @GetMapping("/operations/requests/{requestId}/content-files/{fileId}")
  public ResponseEntity<?> approval(
      @PathVariable Long requestId,
      @PathVariable Long fileId,
      @RequestParam(defaultValue = "false") boolean image) {
    var request = approvals.accessible(requestId, false);
    if (!"CONTENT".equals(request.getBusinessType())) return missing();
    var revision = content.revision(request.getBusinessRevisionId(), request.getBusinessId());
    if (image
        ? !fileId.equals(revision.getCoverId())
        : !revision.getAttachmentIds().contains(fileId)) return missing();
    return download(fileId, image);
  }

  private ResponseEntity<?> download(Long id, boolean image) {
    var file = files.findById(id).orElseThrow(() -> new BusinessException("文件不存在"));
    var disposition = image ? ContentDisposition.inline() : ContentDisposition.attachment();
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            disposition.filename(file.getName(), StandardCharsets.UTF_8).build().toString())
        .contentType(
            MediaType.parseMediaType(image ? assets.imageType(id) : "application/octet-stream"))
        .body(payloads.findById(id).orElseThrow(() -> new BusinessException("文件正文不存在")).getData());
  }
}
