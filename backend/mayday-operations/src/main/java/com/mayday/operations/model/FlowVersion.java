package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 发布版本只新增不改写；实例始终绑定一个确定版本。 */
@Getter
@Setter
@Table(value = "ops_flow_version", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FlowVersion extends BaseEntity
{
    /** 流程定义 ID，外键 ops_flow_definition.id */

    private Long definitionId;
    /** 定义内递增发布版本号，与 definition_id 联合唯一；区别于 JPA version */

    private int versionNumber;
    /** 发布时完整且已校验的流程/表单 JSON；后续改草稿不能覆盖 */

    private String schemaJson;
    /** 发布操作人昵称快照 */

    private String publisherName;
}
