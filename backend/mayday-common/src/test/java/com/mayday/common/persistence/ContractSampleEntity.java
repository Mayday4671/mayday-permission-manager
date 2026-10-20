package com.mayday.common.persistence;

import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 覆盖驼峰、下划线与版本列的代表性字段组合，供持久层契约测试使用。 */
@Getter
@Setter
@Table("contract_sample")
public class ContractSampleEntity extends BaseEntity {
  private String userName;
  private Long departmentId;
}
