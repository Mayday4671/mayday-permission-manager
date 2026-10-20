package com.mayday.operations.feedback.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.operations.feedback.Feedback;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 处理反馈时锁定同一记录，防止并发分配和回复覆盖；匿名只允许摘要精确匹配。 */
@Mapper
public interface FeedbackMapper extends EntityMapper<Feedback> {
  default Optional<Feedback> findByReceiptHash(String receiptHash) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create().where(new QueryColumn("receipt_hash").eq(receiptHash))));
  }

  default Optional<Feedback> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }
}
