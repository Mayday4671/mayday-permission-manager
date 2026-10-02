package com.mayday.operations.repository;

import com.mayday.operations.model.BusinessEvent;
import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 已提交审批消息的持久队列；领取锁和唯一键共同保证多次重试只生成一条投递。 */
public interface BusinessEventRepository extends JpaRepository<BusinessEvent, Long> {
  @Query(
      "select e.id from BusinessEvent e where e.status='PENDING' and e.nextAttemptAt<=:now order by"
          + " e.id")
  List<Long> due(LocalDateTime now, Pageable limit);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select e from BusinessEvent e where e.id=:id")
  Optional<BusinessEvent> lockById(Long id);

  boolean existsByEventKey(String eventKey);

  List<BusinessEvent> findByRequestIdOrderByIdDesc(Long requestId);

  void deleteByRequestId(Long requestId);
}
