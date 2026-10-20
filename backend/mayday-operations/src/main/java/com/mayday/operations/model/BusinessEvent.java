package com.mayday.operations.model;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mayday.common.util.BusinessTime;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 事务发件箱：仅存储最小站内通知数据，不把审批表单或内容正文复制到消息里。 */
@Getter
@Setter
@Table(value = "ops_event", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class BusinessEvent extends BaseEntity
{
    /** 业务事件去重键，唯一；同时传入通知 event_key 防止重试重复投递 */

    private String eventKey;
    /** 关联审批实例 ID，逻辑关联 ops_flow_request.id */

    private Long requestId;
    /** 目标收件账号 ID，逻辑关联 sys_user.id；按生成事件时的业务决定保存 */

    private Long recipientId;
    /** 通知标题快照 */

    private String title;
    /** 通知文本摘要，最多 1000 字；不存任意可执行脚本 */

    private String body;
    /** 投递状态：PENDING 待投递或等待重试、DELIVERED 已投递、SKIPPED 接收账号已删除 */

    private String status = "PENDING";
    /** 失败尝试计数，初始 0、最大记录 10000；指数退避最多一小时，当前持续重试而非达次数终止 */

    private int attempts;
    /** 下一次允许尝试的北京时间；工作器按状态和时间领取 */

    private LocalDateTime nextAttemptAt = BusinessTime.now();
    /** 最近失败信息摘要，最多 500 字；后台 manage 权限可查看，不向普通收件人暴露 */

    private String lastError;
}
