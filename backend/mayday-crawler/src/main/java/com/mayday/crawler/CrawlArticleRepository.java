package com.mayday.crawler;

import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface CrawlArticleRepository
    extends JpaRepository<CrawlArticle, Long>, JpaSpecificationExecutor<CrawlArticle> {
  Optional<CrawlArticle> findByTaskIdAndSourceHash(Long taskId, String sourceHash);

  void deleteByTaskId(Long taskId);

  boolean existsByTaskId(Long taskId);
}
