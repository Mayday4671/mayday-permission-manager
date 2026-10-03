package com.mayday.content;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 不可变正文修订查询；分类、标签和附件的存在性判断保护所有历史引用，而非仅当前上线版本。 */
public interface ContentRevisionRepository
    extends JpaRepository<ContentRevision, Long>, JpaSpecificationExecutor<ContentRevision> {
  List<ContentRevision> findByNoticeIdOrderByRevisionNumberDesc(Long noticeId);

  boolean existsByCategoryId(Long categoryId);

  boolean existsByPortalChannelId(Long portalChannelId);

  boolean existsByTagIdsContains(Long tagId);

  boolean existsByCoverId(Long coverId);

  boolean existsByAttachmentIdsContains(Long fileId);

  /** 只由彻底删除内容的事务调用，普通下线和回收保留历史修订。 */
  void deleteByNoticeId(Long noticeId);
}
