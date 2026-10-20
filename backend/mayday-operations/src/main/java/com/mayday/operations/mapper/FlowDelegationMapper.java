package com.mayday.operations.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowDelegation;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 有效期采用左闭右开区间；创建在账号行锁内检查重叠，防止并发生成委托链。 */
@Mapper
public interface FlowDelegationMapper extends EntityMapper<FlowDelegation>
{
    /** 任一侧命中该账号即视为重叠；撤销时间非空代表不再生效。 */
    default List<FlowDelegation> overlapping(Long userId, LocalDateTime start, LocalDateTime end)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("revoked_at").isNull())
                .and(new QueryColumn("starts_at").lt(end)).and(new QueryColumn("ends_at").gt(start))
                .and(new QueryColumn("owner_id").eq(userId).or(new QueryColumn("target_id").eq(userId))));
    }

    default List<FlowDelegation> effective(Long owner, LocalDateTime now)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("owner_id").eq(owner))
                .and(new QueryColumn("revoked_at").isNull()).and(new QueryColumn("starts_at").le(now))
                .and(new QueryColumn("ends_at").gt(now)).orderBy("id"));
    }
}
