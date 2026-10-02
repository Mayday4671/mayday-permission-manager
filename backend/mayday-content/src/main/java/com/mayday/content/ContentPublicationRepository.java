package com.mayday.content;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 发布记录保留每次实际上线区间；关闭当前记录与切换内容指针在应用层同一事务内执行。 */
public interface ContentPublicationRepository
    extends JpaRepository<ContentPublication, Long>, JpaSpecificationExecutor<ContentPublication> {
  List<ContentPublication> findByNoticeIdAndOfflineAtIsNull(Long noticeId);

  /** 永久删除内容才清除关联发布历史；普通回收保留历史以便恢复和审计。 */
  void deleteByNoticeId(Long noticeId);
}
