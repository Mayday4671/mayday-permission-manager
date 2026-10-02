package com.mayday.{{module}};

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** {{label}}持久化模型。实体仅在模块内部使用，HTTP 输入和输出使用独立 DTO。 */
@Entity
@Table(name = "{{table}}")
@Getter
@Setter
public class {{entity}} extends BaseEntity {
{{entityFields}}

  /** 创建者由当前登录身份赋值，不能从客户端请求接受或在普通编辑中更换。 */
  @Column(nullable = false, updatable = false)
  private Long ownerId;

  /** 创建时的部门归属，用于数据范围判断；调整归属需要另行设计授权动作。 */
  @Column(updatable = false)
  private Long departmentId;
}
