package com.mayday.content.mapper;

import java.io.Serializable;
import java.util.List;
import java.util.Optional;

import com.mayday.content.PortalCategory;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * 分类归属与栏目保存同处事务；拒绝在多个菜单下重复配置同一分类。
 *
 * <p>
 * 主键是资料中心的分类 ID（非自增、无版本列），直接继承 BaseMapper 并提供按主键整行保存的入口。
 */
@Mapper
public interface PortalCategoryMapper extends BaseMapper<PortalCategory>
{
    default List<PortalCategory> findByChannelIdOrderBySortOrderAscCategoryIdAsc(Long channelId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("channel_id").eq(channelId))
                .orderBy("sort_order asc, category_id asc"));
    }

    default boolean existsByChannelId(Long channelId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("channel_id").eq(channelId))) > 0;
    }

    /** 按分类 ID 载入；调用方仍需验证目标栏目与资料类型。 */
    default Optional<PortalCategory> findById(Serializable id)
    {
        return Optional.ofNullable(selectOneById(id));
    }

    /** 主键存在性检查；资料中心删除分类前据此阻止悬空归属。 */
    default boolean existsById(Serializable id)
    {
        return selectOneById(id) != null;
    }

    /** 按分类 ID 整行写入：不存在则插入，存在则覆盖除主键外的全部列。 */
    default PortalCategory save(PortalCategory category)
    {
        if (selectOneById(category.getCategoryId()) == null)
        {
            insert(category, false);
        } else
        {
            update(category, false);
        }
        return category;
    }
}
