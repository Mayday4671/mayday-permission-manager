package com.mayday.operations.feedback;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 客户反馈主记录；查询凭据仅存摘要，匿名响应不包含内部备注和处理人身份。 */
@Getter
@Setter
@Table(
    value = "ops_feedback",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class Feedback extends BaseEntity {
  private String receiptHash;

  private String type;

  private String title;

  private String content;

  private Long articleId;

  private String contact;

  private String status = "OPEN";

  private Long assigneeId;

  private String assigneeName;

  private LocalDateTime repliedAt;
}
