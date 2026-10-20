package com.mayday.operations.model;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 投递与通知同事务提交。唯一键保证一个发布批次只给每位接收者投递一次。 */
@Getter
@Setter
@Table(value = "ops_delivery", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class Delivery extends BaseEntity
{
    /** 发布通知 ID，外键 ops_notification.id，随通知删除级联清理 */

    private Long notificationId;
    /** 收件人账号 ID，逻辑关联 sys_user.id；查询必须等于当前会话账号 */

    private Long recipientId;
    /** 发布时收件人昵称快照；保留当时接收记录 */

    private String recipientName;
    /** 首次阅读时间；NULL 表示未读，标记已读只能作用于自己的投递 */

    private LocalDateTime readAt;
}
