package com.mayday.crawler;
import java.util.*;
import java.time.LocalDateTime;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.domain.Pageable;
public interface CrawlTaskRepository extends JpaRepository<CrawlTask,Long>, JpaSpecificationExecutor<CrawlTask> {
  @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select t from CrawlTask t where t.id=:id") Optional<CrawlTask> lock(Long id);
  @Query("select t.id from CrawlTask t where t.archived=false and t.status in ('QUEUED','RUNNING') and (t.leaseUntil is null or t.leaseUntil<:now) and (t.nextFetchAt is null or t.nextFetchAt<=:now) order by t.nextFetchAt, t.id")
  List<Long> ready(LocalDateTime now, Pageable page);
  long countByOwnerIdAndStatusInAndArchivedFalse(Long ownerId, Collection<String> states);
}
