package com.mayday.operations.feedback.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.feedback.FeedbackHistory;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 按时间和主键稳定展示处理过程；匿名结果由服务层投影过滤内部字段。 */
@Mapper
public interface FeedbackHistoryMapper extends EntityMapper<FeedbackHistory> {
  default List<FeedbackHistory> findByFeedbackIdOrderByIdAsc(Long feedbackId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("feedback_id").eq(feedbackId))
            .orderBy("id asc"));
  }
}
