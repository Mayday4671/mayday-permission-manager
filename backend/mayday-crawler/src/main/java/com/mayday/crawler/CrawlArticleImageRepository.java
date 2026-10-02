package com.mayday.crawler;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** 文章图片引用与下载队列分开保存：队列可去重，但不同文章可以各自关联同一张图片。 */
public interface CrawlArticleImageRepository extends JpaRepository<CrawlArticleImage, Long> {
  boolean existsByArticleIdAndItemId(Long articleId, Long itemId);

  /** 按来源页面和页内位置的复合序号读取，保留失败与待采集条目供详情解释真实采集进度。 */
  @Query(
      "select i from CrawlArticleImage link, CrawlItem i where link.articleId=:articleId and link.itemId=i.id order by link.sortOrder,link.id")
  List<CrawlItem> images(Long articleId);

  /** 彻底清理任务时先移除引用，普通配置归档不调用此接口。 */
  @Modifying
  @Query(
      "delete from CrawlArticleImage link where link.articleId in (select a.id from CrawlArticle a where a.taskId=:taskId)")
  void deleteForTask(Long taskId);
}
