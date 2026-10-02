package com.mayday.crawler;

import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface CrawlArticleImageRepository extends JpaRepository<CrawlArticleImage, Long> {
  boolean existsByArticleIdAndItemId(Long articleId, Long itemId);

  @Query(
      "select i from CrawlArticleImage link, CrawlItem i where link.articleId=:articleId and link.itemId=i.id order by link.sortOrder,link.id")
  List<CrawlItem> images(Long articleId);

  @Modifying
  @Query(
      "delete from CrawlArticleImage link where link.articleId in (select a.id from CrawlArticle a where a.taskId=:taskId)")
  void deleteForTask(Long taskId);
}
