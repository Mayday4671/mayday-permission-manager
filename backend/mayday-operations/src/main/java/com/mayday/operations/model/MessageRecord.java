package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 站内信按收件人独立保存已读状态；发件人与接收者均由服务端校验。 */
@Getter
@Setter
@Table(value = "ops_message", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class MessageRecord extends BaseEntity
{
    /** 旧消息标题；V8 逐条迁移为独立通知 */

    private String title;
    /** 旧消息纯文本正文；迁移时转义为安全 HTML */

    private String content;
    /** 旧发送者账号 ID，逻辑关联 sys_user.id */

    private Long senderId;
    /** 旧发送者昵称快照 */

    private String senderName;
    /** 旧接收者账号 ID，逻辑关联 sys_user.id */

    private Long recipientId;
    /** 旧阅读时间；迁移保留到 ops_delivery.read_at */

    private java.time.LocalDateTime readAt;
}
