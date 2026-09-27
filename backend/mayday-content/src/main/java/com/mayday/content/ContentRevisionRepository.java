package com.mayday.content;

import java.util.List;
import org.springframework.data.jpa.repository.*;

public interface ContentRevisionRepository
    extends JpaRepository<ContentRevision, Long>, JpaSpecificationExecutor<ContentRevision> {
  List<ContentRevision> findByNoticeIdOrderByRevisionNumberDesc(Long noticeId);

  boolean existsByCategoryId(Long categoryId);

  boolean existsByTagIdsContains(Long tagId);

  boolean existsByCoverId(Long coverId);

  boolean existsByAttachmentIdsContains(Long fileId);

  void deleteByNoticeId(Long noticeId);
}
