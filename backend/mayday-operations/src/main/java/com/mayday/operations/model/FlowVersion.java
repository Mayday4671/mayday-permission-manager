package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 发布版本只新增不改写；实例始终绑定一个确定版本。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_version")
public class FlowVersion extends BaseEntity {
  private Long definitionId;
  private int versionNumber;

  @Column(nullable = false, columnDefinition = "longtext")
  private String schemaJson;

  @Column(length = 64)
  private String publisherName;
}
