package com.mayday.crawler.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.crawler.CrawlArticleImage;
import com.mayday.crawler.CrawlItem;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 文章图片引用与下载队列分开保存：队列可去重，但不同文章可以各自关联同一张图片。 */
@Mapper
public interface CrawlArticleImageMapper extends EntityMapper<CrawlArticleImage> {
  default boolean existsByArticleIdAndItemId(Long articleId, Long itemId) {
    return selectCountByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("article_id").eq(articleId))
                .and(new QueryColumn("item_id").eq(itemId)))
        > 0;
  }

  /** 按来源页面和页内位置的复合序号读取，保留失败与待采集条目供详情解释真实采集进度。 */
  default List<CrawlItem> images(Long articleId) {
    return selectListByQueryAs(
        QueryWrapper.create()
            .select("i.*")
            .from("crawl_item i, crawl_article_image l")
            .where("l.item_id = i.id and l.article_id = ?", articleId)
            .orderBy("l.sort_order, l.id"),
        CrawlItem.class);
  }

  /** 彻底清理任务时先移除引用，普通配置归档不调用此接口。 */
  default void deleteForTask(Long taskId) {
    Db.updateBySql(
        "delete from crawl_article_image where article_id in"
            + " (select id from crawl_article where task_id = ?)",
        taskId);
  }
}
