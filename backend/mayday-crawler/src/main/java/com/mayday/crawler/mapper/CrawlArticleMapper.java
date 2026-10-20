package com.mayday.crawler.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.crawler.CrawlArticle;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 同一任务与分页根地址唯一定位文章；配置归档与文章数据删除具有独立生命周期。 */
@Mapper
public interface CrawlArticleMapper extends EntityMapper<CrawlArticle> {
  default Optional<CrawlArticle> findByTaskIdAndSourceHash(Long taskId, String sourceHash) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("source_hash").eq(sourceHash))));
  }

  /** 彻底删除任务的文章数据；调用前必须先清理图片引用和队列条目。 */
  default void deleteByTaskId(Long taskId) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId)));
  }

  default boolean existsByTaskId(Long taskId) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId)))
        > 0;
  }
}
