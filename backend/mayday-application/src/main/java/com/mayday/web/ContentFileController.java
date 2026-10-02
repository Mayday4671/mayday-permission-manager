package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.content.NoticeRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.operations.workflow.WorkflowEngine;
import com.mayday.service.ContentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 文件地址不含令牌，公开封面/附件每次核对文章当前线上版本；下架、替换版本和删除后旧地址立即失效。 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ContentFileController {
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final ContentService content;
  private final StoredFileRepository files;
  private final StoredFileContent fileContent;
  private final WorkflowEngine approvals;

  private ResponseEntity<?> missing() {
    return ResponseEntity.status(404)
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.error("文件不存在或内容未公开"));
  }

  /** 每次请求核对当前线上修订的封面，内容下架或替换封面后旧请求立即失去公开访问权。 */
  @GetMapping("/public/articles/{id}/cover")
  public ResponseEntity<?> cover(@PathVariable Long id) {
    return publicFile(id, null, true);
  }

  /** 只下载当前公开修订实际关联的附件，猜测无关文件 ID 不会扩展公开访问范围。 */
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

  /** 管理端检查内容数据范围、修订归属及文件关联后读取，不单凭文件 ID 授予访问权。 */
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

  /** 审批参与者只能读取该请求绑定的内容快照附件，后续新修订不能替换待审批材料。 */
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
    return fileContent.response(file, image, false);
  }
}
