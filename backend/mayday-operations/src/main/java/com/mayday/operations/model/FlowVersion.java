package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 发布版本只新增不改写；实例始终绑定一个确定版本。 */
@Getter
@Setter
@Table(
    value = "ops_flow_version",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowVersion extends BaseEntity {
  private Long definitionId;
  private int versionNumber;

  private String schemaJson;

  private String publisherName;
}
