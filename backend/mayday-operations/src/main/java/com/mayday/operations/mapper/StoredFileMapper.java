package com.mayday.operations.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.StoredFile;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 仅查询元信息；修改、回收和清理以行锁串行化，防止并发恢复与永久删除交错。 */
@Mapper
public interface StoredFileMapper extends EntityMapper<StoredFile>
{
    default Optional<StoredFile> lock(Long id)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
    }

    default boolean existsByDirectoryId(Long directoryId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("directory_id").eq(directoryId))) > 0;
    }

    /** 清理工作器每轮只领取最早请求永久删除的少量文件，避免单次批处理过载。 */
    default List<StoredFile> findTop10ByPurgeRequestedAtIsNotNullOrderByPurgeRequestedAtAsc()
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("purge_requested_at").isNotNull())
                .orderBy("purge_requested_at asc").limit(10));
    }
}
