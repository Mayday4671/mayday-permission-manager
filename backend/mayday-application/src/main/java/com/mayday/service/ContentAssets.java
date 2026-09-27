package com.mayday.service;

import com.mayday.common.*;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.*;
import com.mayday.security.AccessPolicy;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/** 内容文件规则独立于编辑器：关联检查归属，封面检查实际字节格式，删除检查全部历史修订引用。 */
@Service
@RequiredArgsConstructor
public class ContentAssets implements FileUsage {
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final ContentRevisionRepository revisions;
  private final AccessPolicy access;

  public void validate(Set<Long> attachmentIds, Long coverId) {
    Set<Long> ids = new HashSet<>(attachmentIds);
    if (coverId != null) ids.add(coverId);
    var found = files.findAllById(ids);
    if (found.size() != ids.size()) throw new BusinessException("文件已删除或不存在");
    for (var file : found)
      if (!access.has("files:all") && !Objects.equals(file.getOwnerId(), access.current().getId()))
        throw new AccessDeniedException("不能关联其他人的文件");
    if (coverId != null) imageType(coverId);
  }

  public String imageType(Long id) {
    byte[] b = payloads.findById(id).orElseThrow(() -> new BusinessException("文件内容不存在")).getData();
    if (b.length >= 8
        && b[0] == (byte) 0x89
        && b[1] == 'P'
        && b[2] == 'N'
        && b[3] == 'G'
        && b[4] == 13
        && b[5] == 10
        && b[6] == 26
        && b[7] == 10) return "image/png";
    if (b.length >= 3 && b[0] == (byte) 0xff && b[1] == (byte) 0xd8 && b[2] == (byte) 0xff)
      return "image/jpeg";
    if (b.length >= 12
        && b[0] == 'R'
        && b[1] == 'I'
        && b[2] == 'F'
        && b[3] == 'F'
        && b[8] == 'W'
        && b[9] == 'E'
        && b[10] == 'B'
        && b[11] == 'P') return "image/webp";
    throw new BusinessException("封面仅支持有效 PNG、JPEG 或 WebP 图片");
  }

  public List<StoredFile> records(Set<Long> ids) {
    return files.findAllById(ids);
  }

  public StoredFile record(Long id) {
    return id == null ? null : files.findById(id).orElse(null);
  }

  @Override
  public boolean referenced(Long id) {
    return revisions.existsByCoverId(id) || revisions.existsByAttachmentIdsContains(id);
  }
}
