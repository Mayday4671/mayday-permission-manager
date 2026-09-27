package com.mayday.operations.web;

import com.mayday.common.BusinessException;
import com.mayday.operations.NotificationService;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.*;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 业务附件以通知访问权鉴权，不授予收件人整个文件中心的下载权限。撤回/过期会同步关闭旧下载地址。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class NotificationAttachmentController {
  private final NotificationService service;
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;

  @GetMapping("/messages/{messageId}/attachments/{fileId}")
  public ResponseEntity<byte[]> received(@PathVariable Long messageId, @PathVariable Long fileId) {
    var n = service.ownMessage(messageId).getNotification();
    if (!n.getAttachmentIds().contains(fileId)) throw new AccessDeniedException("文件不属于此通知");
    return download(fileId);
  }

  @GetMapping("/notifications/{notificationId}/attachments/{fileId}")
  public ResponseEntity<byte[]> managed(
      @PathVariable Long notificationId, @PathVariable Long fileId) {
    var n = service.getManaged(notificationId);
    if (!n.getAttachmentIds().contains(fileId)) throw new AccessDeniedException("文件不属于此通知");
    return download(fileId);
  }

  private ResponseEntity<byte[]> download(Long id) {
    StoredFile file = files.findById(id).orElseThrow(() -> new BusinessException("文件不存在"));
    return ResponseEntity.ok()
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(file.getName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(payloads.findById(id).orElseThrow(() -> new BusinessException("文件正文不存在")).getData());
  }
}
