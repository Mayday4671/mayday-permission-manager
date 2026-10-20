package com.mayday.operations.feedback;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/** 每次处理保留不可编辑轨迹；publicReply 与内部备注分别存储和授权返回。 */
@Schema(requiredProperties =
{"id", "version", "feedbackId", "actor", "status", "createdAt"})
@Getter
@Setter
@Table(value = "ops_feedback_history", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FeedbackHistory extends BaseEntity
{
    private Long feedbackId;

    private String actor;

    private String status;

    private String publicReply;

    private String internalNote;
}
