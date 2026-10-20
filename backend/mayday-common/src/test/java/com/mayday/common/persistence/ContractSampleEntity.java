package com.mayday.common.persistence;

import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 覆盖驼峰、下划线与版本列的代表性字段组合，供持久层契约测试使用。 */
@Getter
@Setter
@Table("contract_sample")
public class ContractSampleEntity extends BaseEntity
{
    /** 覆盖驼峰转下划线的示例名称列。 */
    private String userName;

    /** 覆盖外键风格命名与范围条件构建的示例部门列。 */
    private Long departmentId;
}
