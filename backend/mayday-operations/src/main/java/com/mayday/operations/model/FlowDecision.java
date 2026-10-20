package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 审批历史只追加，申请人和审批参与人可查询。 */
@Getter
@Setter
@Table(value = "ops_flow_decision", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowDecision extends BaseEntity
{
    /** 决定与提交轮次、节点批次关联，退回重办保留各次决定，不能混算会签结果。 */
    private int runNumber = 1;
    /** 决定所属节点办理批次；进入下一节点前的决定归属于原任务批次 */

    private int nodeVisit;
    /** 退回目标节点稳定ID；为空表示退回申请人，其他动作不用 */

    private String targetNodeId;
    /** 审批实例 ID，逻辑关联 ops_flow_request.id */

    private Long requestId;

    /** 字段改动只在服务层按查看人的字段范围过滤后返回，禁止直接序列化实体。 */
    private String changesJson;

    /** 每轮提交保留独立表单快照；对外读取仍按当前查看人的可读字段裁剪。 */
    private String formSnapshot;
    /** 操作账号 ID，逻辑关联 sys_user.id */

    private Long actorId;
    /** 操作人昵称快照 */

    private String actorName;
    /** 操作类型：SUBMIT/APPROVE/REJECT/WITHDRAW/COMMENT/TRANSFER/ADD_SIGN 等服务端定义值 */

    private String action;
    /** 审批意见或操作说明，最多 500 字 */

    private String comment;
    /** 操作节点的模型 ID；发起或整体操作可为空 */

    private String nodeId;
    /** 操作时节点名称快照 */

    private String nodeName;
    /** 转交或加签目标账号 ID，逻辑关联 sys_user.id；其他动作可为空 */

    private Long targetUserId;
    /** 转交/加签目标昵称快照 */

    private String targetUserName;
}
