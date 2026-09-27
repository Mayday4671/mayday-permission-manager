package com.mayday.content;

import org.springframework.data.jpa.repository.*;

/** 内容查询由应用层组合权限条件；状态变化共用主记录行锁，防止发布、排期、删除并发覆盖。 */
public interface NoticeRepository
    extends JpaRepository<Notice, Long>, JpaSpecificationExecutor<Notice> {
  long countByPublished(boolean published);

  boolean existsByDepartmentId(Long departmentId);

  @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @Query("select n from Notice n where n.id=:id")
  java.util.Optional<Notice> lockById(Long id);

  @Modifying
  @Query("update Notice n set n.viewCount=n.viewCount+1 where n.id=:id")
  void incrementViews(Long id);
}
