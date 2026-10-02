package com.mayday.crawler;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 同一任务与分页根地址唯一定位文章；配置归档与文章数据删除具有独立生命周期。 */
public interface CrawlArticleRepository
    extends JpaRepository<CrawlArticle, Long>, JpaSpecificationExecutor<CrawlArticle> {
  Optional<CrawlArticle> findByTaskIdAndSourceHash(Long taskId, String sourceHash);

  void deleteByTaskId(Long taskId);

  boolean existsByTaskId(Long taskId);
}
