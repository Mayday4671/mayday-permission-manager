package com.mayday.crawler;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** URL 唯一键保护循环分页；按摘要复用成功图片，按页序读取正文，不按异步完成时间排序。 */
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

  /** 所有有效图片引用都保护正文文件，归档配置不会使对应数据失去删除保护。 */
  boolean existsByFileId(Long fileId);

  void deleteByTaskId(Long taskId);
}
