package com.mayday.operations.model;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 临时审批委托只追加或撤销；不改写已办理历史，不把接收委托当作角色授权。 */
@Getter
@Setter
@Table(value = "ops_flow_delegation", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowDelegation extends BaseEntity
{
    private Long ownerId;

    private String ownerName;

    private Long targetId;

    private String targetName;

    private LocalDateTime startsAt;

    private LocalDateTime endsAt;

    /** 空数组表示全部审批流程；非空数组只包含发布定义编号，不绑定设计草稿。 */
    private String definitionIdsJson;

    private String reason;

    /** 撤销仅阻止后续任务委托；已经激活的任务需显式转交或管理员交接。 */
    private LocalDateTime revokedAt;
}
