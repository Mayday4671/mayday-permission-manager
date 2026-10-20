package com.mayday.operations.mapper;

import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowVersion;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 发布版本只追加不覆盖，编号由定义锁下产生，历史申请始终引用原版本。 */
@Mapper
public interface FlowVersionMapper extends EntityMapper<FlowVersion>
{
    default List<FlowVersion> findByDefinitionIdOrderByVersionNumberDesc(Long definitionId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("definition_id").eq(definitionId))
                .orderBy("version_number desc"));
    }
}
