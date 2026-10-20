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

    /** 所属反馈主键；服务端从当前锁定反馈取值，不接受客户端替换目标 */
    private Long feedbackId;

    /** 处理时有效会话的账号名；匿名查询不返回内部人员身份 */
    private String actor;

    /** 该次处理后的反馈状态：OPEN、PROCESSING、RESOLVED、CLOSED */
    private String status;

    /** 客户凭查询码可看到的纯文本回复；无公开回复的分配或备注操作可为空 */
    private String publicReply;

    /** 仅后台可见的内部处理备注；匿名查询投影明确排除 */
    private String internalNote;
}
