package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/** 定时任务只能绑定预注册处理器；禁止任意 URL、脚本和 Java 类名作为执行入口。 */
@Getter
@Setter
@Schema(requiredProperties =
{"id", "version", "name", "handler", "cron", "enabled", "createdAt"})
@Table(value = "ops_job", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class ScheduledJob extends BaseEntity
{
    private String name;

    private String handler;

    private String cron;

    private String description;

    private boolean enabled;
    private java.time.LocalDateTime nextRunAt;

    /** 失败提醒接收人；只选择有调度查看权限的有效账号，空值不发送提醒。 */
    private Long alertUserId;
}
