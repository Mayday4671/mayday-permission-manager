package com.mayday.crawler;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** 图片队列在同任务去重，但文章引用独立保存，防止相同图片在另一篇文章中消失。 */
@Entity
@Table(
    name = "crawl_article_image",
    uniqueConstraints = @UniqueConstraint(columnNames = {"article_id", "item_id"}))
@Getter
@Setter
public class CrawlArticleImage extends BaseEntity {
  @Column(nullable = false)
  private Long articleId;

  @Column(nullable = false)
  private Long itemId;

  @Column(nullable = false)
  /** 详情页序号与页内图片位置共同确定顺序，不能依据异步下载完成时间排序。 */
  private int sortOrder;
}
