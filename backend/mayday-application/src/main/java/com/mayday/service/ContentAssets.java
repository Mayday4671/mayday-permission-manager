package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.common.FileUsage;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/** 内容文件规则独立于编辑器：关联检查归属，封面检查实际字节格式，删除检查全部历史修订引用。 */
@Service
@RequiredArgsConstructor
public class ContentAssets implements FileUsage {
  private final StoredFileRepository files;
  private final StoredFileContent content;
  private final ContentRevisionRepository revisions;
  private final AccessPolicy access;

  /** 在业务写事务中按固定顺序锁定附件，检查所有者和有效状态，阻止关联与回收之间的竞态。 */
  public void validate(Set<Long> attachmentIds, Long coverId) {
    Set<Long> ids = new HashSet<>(attachmentIds);
    if (coverId != null) ids.add(coverId);
    // 与回收任务使用同一文件行锁；验证到业务提交期间，附件不能被另一个请求回收。
    for (Long identifier : ids.stream().sorted().toList()) {
      var file = files.lock(identifier).orElseThrow(() -> new BusinessException("文件已删除或不存在"));
      StoredFileContent.active(file);
      if (!access.has("files:all") && !Objects.equals(file.getOwnerId(), access.current().getId()))
        throw new AccessDeniedException("不能关联其他人的文件");
    }
    if (coverId != null) imageType(coverId);
  }

  /** 统一读取本地、对象存储或旧数据库正文的签名，封面格式不信任文件名或客户端声明。 */
  public String imageType(Long id) {
    StoredFile file = files.findById(id).orElseThrow(() -> new BusinessException("文件不存在"));
    return content.imageType(file);
  }

  /** 返回附件元信息而不加载正文；调用者必须先完成所属内容的业务访问检查。 */
  public List<StoredFile> records(Set<Long> ids) {
    return files.findAllById(ids);
  }

  /** 读取已授权内容的可选封面元信息，未配置或已不存在时返回空值供页面展示降级。 */
  public StoredFile record(Long id) {
    return id == null ? null : files.findById(id).orElse(null);
  }

  @Override
  public boolean referenced(Long id) {
    return revisions.existsByCoverId(id) || revisions.existsByAttachmentIdsContains(id);
  }
}
