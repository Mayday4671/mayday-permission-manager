package com.mayday.operations.web;

import com.mayday.common.BusinessException;
import com.mayday.operations.repository.*;
import com.mayday.operations.workflow.WorkflowEngine;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 审批附件按实例参与权和节点字段读取权验证，不能以文件中心地址绕过。 */
@RestController
@RequestMapping("/api/operations/requests")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowFileController {
  private final WorkflowEngine engine;
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;

  @GetMapping("/{id}/files/{fileId}")
  public ResponseEntity<byte[]> download(@PathVariable Long id, @PathVariable Long fileId) {
    engine.checkFile(id, fileId);
    var file = files.findById(fileId).orElseThrow(() -> new BusinessException("附件不存在"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(file.getName(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(
            payloads
                .findById(fileId)
                .orElseThrow(() -> new BusinessException("文件正文不存在"))
                .getData());
  }
}
