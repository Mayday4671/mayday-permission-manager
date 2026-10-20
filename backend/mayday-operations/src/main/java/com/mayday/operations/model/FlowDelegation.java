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
    /** 委托创建账号，由当前会话决定；不能由请求指定他人 */

    private Long ownerId;
    /** 创建时原审批人名称快照，不随用户改名重写 */

    private String ownerName;
    /** 受托审批账号；创建和任务激活时重新检查有效权限 */

    private Long targetId;
    /** 创建时受托人名称快照，供安排历史展示 */

    private String targetName;
    /** 委托开始时间，包含此时刻；单条时段最长90天 */

    private LocalDateTime startsAt;
    /** 委托结束时间，不包含此时刻；结束不改写已激活任务 */

    private LocalDateTime endsAt;

    /** 空数组表示全部审批流程；非空数组只包含发布定义编号，不绑定设计草稿。 */
    private String definitionIdsJson;
    /** 创建时填写的委托原因，历史保留，不允许事后改写 */

    private String reason;

    /** 撤销仅阻止后续任务委托；已经激活的任务需显式转交或管理员交接。 */
    private LocalDateTime revokedAt;
}
