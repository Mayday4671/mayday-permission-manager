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

    private int nodeVisit;

    private String targetNodeId;

    private Long requestId;

    /** 字段改动只在服务层按查看人的字段范围过滤后返回，禁止直接序列化实体。 */
    private String changesJson;

    /** 每轮提交保留独立表单快照；对外读取仍按当前查看人的可读字段裁剪。 */
    private String formSnapshot;

    private Long actorId;

    private String actorName;

    private String action;

    private String comment;

    private String nodeId;

    private String nodeName;

    private Long targetUserId;

    private String targetUserName;
}
