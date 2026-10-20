package com.mayday.operations.model;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 每人一条待办。申请主记录行锁保护整组会签；转交保留原任务为历史，加签标记为必签。 */
@Getter
@Setter
@Table(value = "ops_flow_task", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowTask extends BaseEntity
{
    /** 审批实例 ID，外键 ops_flow_request.id */

    private Long requestId;
    /** 模型节点稳定 ID，与实例快照中节点对应 */

    private String nodeId;
    /** 生成任务时节点名称快照 */

    private String nodeName;
    /** 待办账号 ID，逻辑关联 sys_user.id；不能由请求参数冒充 */

    private Long assigneeId;
    /** 待办人昵称快照 */

    private String assigneeName;

    /** 临时委托或管理员交接前的原指定人；为空表示任务没有发生归属替换。 */
    private Long originalAssigneeId;

    /** 原指定审批人名称快照；没有替换任务归属时为空。 */
    private String originalAssigneeName;

    /** 已激活的任务保存委托来源；委托撤销或到期不追溯改变该任务。 */
    private Long delegationId;

    /** 任务归属说明：委托来源、交接理由或委托不适用原因；不包含隐藏表单字段。 */
    private String assignmentNote;
    /**
     * 任务状态：WAITING顺签未轮到/PENDING待办/APPROVED通过/REJECTED驳回/RETURNED退回/TRANSFERRED转交/CANCELLED失效/COPIED抄送
     */

    private String status = "PENDING";
    /** 加签必签标记；1 时必须独立通过，不能被原或签审批人的通过代替 */

    private boolean mandatory;

    /** 任务属于哪个提交轮次和节点办理批次；旧任务只用于历史展示。 */
    private int runNumber = 1;
    /** 所属节点办理批次；同一节点退回重办不得混用以前的会签结果 */

    private int nodeVisit;

    /** 并行办理只核验本游标的访问批次，不能用申请最后激活的节点排除其他合法支路。 */
    private String executionTokenId;

    /** 抄送没有审批能力；顺签尚未轮到的任务为 WAITING，不计入个人待办。 */
    private String kind = "APPROVAL";

    /** 仅抄送接收者能标记已读，不能修改其他接收者的阅读状态。 */
    private LocalDateTime readAt;
    /** 任务已处理时间；尚未处理时为 NULL */

    private LocalDateTime decidedAt;

    /**
     * 实际获得节点办理/抄送资格的时间。顺签排队及其取消记录保持为空，不能仅凭任务状态授予字段读取权；
     * 激活、人员委托、站内事件与业务推进同事务提交，回滚时不会留下虚假的授权凭证。
     */
    private LocalDateTime activatedAt;

    /** 从申请冻结的节点超时配置推算；转交和加签继承当前节点期限，不因换人重置。 */
    private LocalDateTime dueAt;

    /** 同一任务只投递一次自动超时提醒，轮询和服务重启不会重复轰炸。 */
    private LocalDateTime timeoutNotifiedAt;
}
