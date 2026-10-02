package com.mayday.content;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** 内容查询由应用层组合权限条件；状态变化共用主记录行锁，防止发布、排期、删除并发覆盖。 */
public interface NoticeRepository
    extends JpaRepository<Notice, Long>, JpaSpecificationExecutor<Notice> {
  long countByPublished(boolean published);

  boolean existsByDepartmentId(Long departmentId);

  /** 发布、回收及定时排期共用行锁，使状态指针在同一事务内完成切换。 */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select n from Notice n where n.id=:id")
  Optional<Notice> lockById(Long id);

  /** 在数据库中原子累加，避免多个门户访问用“先读后写”丢失浏览次数。 */
  @Modifying
  @Query("update Notice n set n.viewCount=n.viewCount+1 where n.id=:id")
  void incrementViews(Long id);
}
