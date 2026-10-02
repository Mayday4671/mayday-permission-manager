package com.mayday.operations.feedback;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 按时间和主键稳定展示处理过程；匿名结果由服务层投影过滤内部字段。 */
public interface FeedbackHistoryRepository extends JpaRepository<FeedbackHistory, Long> {
  List<FeedbackHistory> findByFeedbackIdOrderByIdAsc(Long feedbackId);
}
