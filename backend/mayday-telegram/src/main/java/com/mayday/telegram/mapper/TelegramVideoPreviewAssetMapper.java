package com.mayday.telegram.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramVideoPreviewAsset;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** MyBatis-Flex 访问已经发布或等待清理的 HLS 对象引用。 */
@Mapper
public interface TelegramVideoPreviewAssetMapper extends EntityMapper<TelegramVideoPreviewAsset>
{
    /** 查找清单中的一个资源文件，名称必须由服务层匹配严格格式后传入。 */
    default Optional<TelegramVideoPreviewAsset> findByPreviewAndName(Long previewId, String assetName)
    {
        return Optional.ofNullable(selectOneByQuery(QueryWrapper.create()
                .where(new QueryColumn("preview_id").eq(previewId)).and(new QueryColumn("asset_name").eq(assetName))));
    }

    /** 按 ID 稳定读取任务的全部资产，清理和验证均不使用任意存储目录。 */
    default List<TelegramVideoPreviewAsset> findForPreview(Long previewId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("preview_id").eq(previewId))
                .orderBy(new QueryColumn("id").asc()));
    }

    /** 锁定所有分片，避免并发清理两次删除不同批次的对象。 */
    default List<TelegramVideoPreviewAsset> lockForPreview(Long previewId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("preview_id").eq(previewId))
                .orderBy(new QueryColumn("id").asc()).forUpdate());
    }
}
