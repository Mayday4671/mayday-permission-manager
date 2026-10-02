package com.mayday.crawler;

import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface CrawlItemRepository
    extends JpaRepository<CrawlItem, Long>, JpaSpecificationExecutor<CrawlItem> {
  Optional<CrawlItem> findFirstByTaskIdAndStatusOrderByIdAsc(Long taskId, String status);

  List<CrawlItem> findByTaskIdAndStatus(Long taskId, String status);

  boolean existsByTaskIdAndKindAndUrlHash(Long taskId, String kind, String urlHash);

  Optional<CrawlItem> findByTaskIdAndKindAndUrlHash(Long taskId, String kind, String urlHash);

  List<CrawlItem> findByArticleIdOrderByOrdinalAscIdAsc(Long articleId);

  long countByArticleId(Long articleId);

  long countByTaskId(Long taskId);

  long countByTaskIdAndKind(Long taskId, String kind);

  long countByTaskIdAndKindAndRootUrl(Long taskId, String kind, String rootUrl);

  Optional<CrawlItem> findFirstByTaskIdAndDigestAndStatus(
      Long taskId, String digest, String status);

  boolean existsByFileId(Long fileId);

  void deleteByTaskId(Long taskId);
}
