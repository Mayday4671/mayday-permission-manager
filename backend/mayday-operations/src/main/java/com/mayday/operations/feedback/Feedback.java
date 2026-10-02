package com.mayday.operations.feedback;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 客户反馈主记录；查询凭据仅存摘要，匿名响应不包含内部备注和处理人身份。 */
@Entity
@Table(name = "ops_feedback")
@Getter
@Setter
public class Feedback extends BaseEntity {
  @Column(nullable = false, unique = true, length = 64)
  private String receiptHash;

  @Column(nullable = false, length = 16)
  private String type;

  @Column(nullable = false, length = 160)
  private String title;

  @Column(nullable = false, length = 4000)
  private String content;

  private Long articleId;

  @Column(length = 254)
  private String contact;

  @Column(nullable = false, length = 16)
  private String status = "OPEN";

  private Long assigneeId;

  @Column(length = 64)
  private String assigneeName;

  private LocalDateTime repliedAt;
}
