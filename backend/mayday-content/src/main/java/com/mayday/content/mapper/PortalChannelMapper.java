package com.mayday.content.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.content.PortalChannel;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 门户栏目按显式排序读取；唯一访问名称由数据库约束处理并发新增冲突。 */
@Mapper
public interface PortalChannelMapper extends EntityMapper<PortalChannel>
{
    default List<PortalChannel> findAllByOrderBySortOrderAscIdAsc()
    {
        return selectListByQuery(QueryWrapper.create().orderBy("sort_order asc, id asc"));
    }

    default Optional<PortalChannel> findByCode(String code)
    {
        return Optional.ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("code").eq(code))));
    }
}
