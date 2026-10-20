package com.mayday.workorders;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 工单管理持久化模型。实体仅在模块内部使用，HTTP 输入和输出使用独立 DTO。 */
@Getter
@Setter
@Table(value = "biz_work_order", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class WorkOrder extends BaseEntity
{
    /** 标题；最大 160 个字符。 */
    private String title;

    /** 说明；最大 1000 个字符。 */
    private String description;

    /** 启用状态；不接受空值。 */
    private Boolean enabled;

    /** 创建者由当前登录身份赋值，不能从客户端请求接受或在普通编辑中更换。 */
    private Long ownerId;

    /** 创建时的部门归属，用于数据范围判断；调整归属需要另行设计授权动作。 */
    private Long departmentId;
}
