package com.mayday.operations.web;

import com.mayday.common.BusinessException;
import com.mayday.operations.NotificationService;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 通知附件以通知访问权鉴权，不授予收件人整个文件中心权限；撤回和过期同步关闭旧地址。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class NotificationAttachmentController {
  private final NotificationService service;
  private final StoredFileRepository files;
  private final StoredFileContent content;

  /** 校验当前收件人和通知有效期后，才允许读取当前通知确实关联的附件。 */
  @GetMapping("/messages/{messageId}/attachments/{fileId}")
  public ResponseEntity<Resource> received(
      @PathVariable Long messageId, @PathVariable Long fileId) {
    var notification = service.ownMessage(messageId).getNotification();
    if (!notification.getAttachmentIds().contains(fileId))
      throw new AccessDeniedException("文件不属于此通知");
    return download(fileId);
  }

  /** 管理者仍须满足通知数据范围，不通过附件地址扩大原有通知查看权限。 */
  @GetMapping("/notifications/{notificationId}/attachments/{fileId}")
  public ResponseEntity<Resource> managed(
      @PathVariable Long notificationId, @PathVariable Long fileId) {
    var notification = service.getManaged(notificationId);
    if (!notification.getAttachmentIds().contains(fileId))
      throw new AccessDeniedException("文件不属于此通知");
    return download(fileId);
  }

  private ResponseEntity<Resource> download(Long id) {
    var file = files.findById(id).orElseThrow(() -> new BusinessException("文件不存在"));
    return content.response(file, false, false);
  }
}
