package com.mayday.operations.feedback;

import com.mayday.common.BaseEntity;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 每次处理保留不可编辑轨迹；publicReply 与内部备注分别存储和授权返回。 */
@Entity
@Table(name = "ops_feedback_history")
@Schema(requiredProperties = {"id", "version", "feedbackId", "actor", "status", "createdAt"})
@Getter
@Setter
public class FeedbackHistory extends BaseEntity {
  private Long feedbackId;

  @Column(nullable = false, length = 64)
  private String actor;

  @Column(nullable = false, length = 16)
  private String status;

  @Column(length = 2000)
  private String publicReply;

  @Column(length = 2000)
  private String internalNote;
}
