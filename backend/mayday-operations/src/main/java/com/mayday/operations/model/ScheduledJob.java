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
    /** 任务显示名称 */

    private String name;
    /** 固定处理器：SESSION_CLEANUP 清理过期会话或 DATABASE_CHECK 检查数据库 */

    private String handler;
    /** Spring 六段 Cron，秒 分 时 日 月 周；应用在保存时校验并计算下一次执行 */

    private String cron;
    /** 任务用途说明 */

    private String description;
    /** 启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验 */

    private boolean enabled;
    /** 下一次计划执行北京时间；停用任务为 NULL，轮询通过行锁避免重复领取 */

    private java.time.LocalDateTime nextRunAt;

    /** 失败提醒接收人；只选择有调度查看权限的有效账号，空值不发送提醒。 */
    private Long alertUserId;
}
