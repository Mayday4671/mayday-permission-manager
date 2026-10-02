package com.mayday.operations.web;

import com.mayday.common.BusinessException;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.operations.workflow.WorkflowEngine;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 审批附件按实例参与权和节点字段读取权验证，存储模式变化不改变原有审批的授权边界。 */
@RestController
@RequestMapping("/api/operations/requests")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowFileController {
  private final WorkflowEngine engine;
  private final StoredFileRepository files;
  private final StoredFileContent content;

  /** 核对审批参与关系及请求实际附件后流式下载，复用统一存储并拒绝回收文件。 */
  @GetMapping("/{id}/files/{fileId}")
  public ResponseEntity<Resource> download(@PathVariable Long id, @PathVariable Long fileId) {
    engine.checkFile(id, fileId);
    var file = files.findById(fileId).orElseThrow(() -> new BusinessException("附件不存在"));
    return content.response(file, false, false);
  }
}
