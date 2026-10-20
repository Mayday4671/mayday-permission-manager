package com.mayday.crawler.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.crawler.CrawlItem;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** URL 唯一键保护循环分页；按摘要复用成功图片，按页序读取正文，不按异步完成时间排序。 */
@Mapper
public interface CrawlItemMapper extends EntityMapper<CrawlItem> {
  default Optional<CrawlItem> findFirstByTaskIdAndStatusOrderByIdAsc(Long taskId, String status) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("status").eq(status))
                .orderBy("id asc")
                .limit(1)));
  }

  default List<CrawlItem> findByTaskIdAndStatus(Long taskId, String status) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("task_id").eq(taskId))
            .and(new QueryColumn("status").eq(status)));
  }

  default boolean existsByTaskIdAndKindAndUrlHash(Long taskId, String kind, String urlHash) {
    return countByTaskIdAndKindAndUrlHash(taskId, kind, urlHash) > 0;
  }

  default Optional<CrawlItem> findByTaskIdAndKindAndUrlHash(
      Long taskId, String kind, String urlHash) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("kind").eq(kind))
                .and(new QueryColumn("url_hash").eq(urlHash))));
  }

  default List<CrawlItem> findByArticleIdOrderByOrdinalAscIdAsc(Long articleId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("article_id").eq(articleId))
            .orderBy("ordinal asc, id asc"));
  }

  default long countByArticleId(Long articleId) {
    return selectCountByQuery(
        QueryWrapper.create().where(new QueryColumn("article_id").eq(articleId)));
  }

  default long countByTaskId(Long taskId) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId)));
  }

  default long countByTaskIdAndKind(Long taskId, String kind) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("task_id").eq(taskId))
            .and(new QueryColumn("kind").eq(kind)));
  }

  default long countByTaskIdAndKindAndRootUrl(Long taskId, String kind, String rootUrl) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("task_id").eq(taskId))
            .and(new QueryColumn("kind").eq(kind))
            .and(new QueryColumn("root_url").eq(rootUrl)));
  }

  default Optional<CrawlItem> findFirstByTaskIdAndDigestAndStatus(
      Long taskId, String digest, String status) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("digest").eq(digest))
                .and(new QueryColumn("status").eq(status))
                .limit(1)));
  }

  /** 所有有效图片引用都保护正文文件，归档配置不会使对应数据失去删除保护。 */
  default boolean existsByFileId(Long fileId) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("file_id").eq(fileId)))
        > 0;
  }

  /** 彻底删除任务的队列数据；调用前必须先清理文章图片引用。 */
  default void deleteByTaskId(Long taskId) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId)));
  }

  /** 详情页条目按任务计数；详情组内序号固定为 0，统计封面组不受影响。 */
  default long countByTaskIdAndKindAndOrdinal(Long taskId, String kind, int ordinal) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("task_id").eq(taskId))
            .and(new QueryColumn("kind").eq(kind))
            .and(new QueryColumn("ordinal").eq(ordinal)));
  }

  /** 同任务同类型 URL 摘要计数；存在性与定位共用同一组条件。 */
  private long countByTaskIdAndKindAndUrlHash(Long taskId, String kind, String urlHash) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("task_id").eq(taskId))
            .and(new QueryColumn("kind").eq(kind))
            .and(new QueryColumn("url_hash").eq(urlHash)));
  }
}
