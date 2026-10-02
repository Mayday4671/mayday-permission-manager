package com.mayday.operations.feedback;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 处理反馈时锁定同一记录，防止并发分配和回复覆盖；匿名只允许摘要精确匹配。 */
public interface FeedbackRepository
    extends JpaRepository<Feedback, Long>, JpaSpecificationExecutor<Feedback> {
  Optional<Feedback> findByReceiptHash(String receiptHash);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select feedback from Feedback feedback where feedback.id = :id")
  Optional<Feedback> lock(@Param("id") Long id);
}
