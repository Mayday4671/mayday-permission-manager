package com.mayday.system.mapper;

import java.util.List;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.system.model.DictionaryItem;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 字典项与类型独立存储；仓储查询不校验字典权限和类型归属，调用方必须先验证目标字典。 */
@Mapper
public interface DictionaryItemMapper extends EntityMapper<DictionaryItem>
{
    /** 删除字典类型前检查是否还有任何关联项，停用字典项也不能绕过引用保护。 */
    default boolean existsByDictionaryId(Long dictionaryId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("dictionary_id").eq(dictionaryId))) > 0;
    }

    /** 只读取有效字典项并稳定排序，供已经获准使用该字典的表单选项接口调用。 */
    default List<DictionaryItem> findByDictionaryIdAndEnabledTrueOrderBySortOrderAscIdAsc(Long dictionaryId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("dictionary_id").eq(dictionaryId))
                .and(new QueryColumn("enabled").eq(true)).orderBy("sort_order asc, id asc"));
    }
}
