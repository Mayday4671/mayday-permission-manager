package com.mayday.workorders;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 工单管理持久化模型。实体仅在模块内部使用，HTTP 输入和输出使用独立 DTO。 */
@Entity
@Table(name = "biz_work_order")
@Getter
@Setter
public class WorkOrder extends BaseEntity {
  /** 标题；最大 160 个字符。 */
  @Column(nullable = false, length = 160)
  private String title;

  /** 说明；最大 1000 个字符。 */
  @Column(length = 1000)
  private String description;

  /** 启用状态；不接受空值。 */
  @Column(nullable = false, name = "enabled")
  private Boolean enabled;

  /** 创建者由当前登录身份赋值，不能从客户端请求接受或在普通编辑中更换。 */
  @Column(nullable = false, updatable = false)
  private Long ownerId;

  /** 创建时的部门归属，用于数据范围判断；调整归属需要另行设计授权动作。 */
  @Column(updatable = false)
  private Long departmentId;
}
