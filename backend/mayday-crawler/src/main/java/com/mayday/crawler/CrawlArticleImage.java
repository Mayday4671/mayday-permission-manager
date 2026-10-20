package com.mayday.crawler;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 图片队列在同任务去重，但文章引用独立保存，防止相同图片在另一篇文章中消失。 */
@Getter
@Setter
@Table(
    value = "crawl_article_image",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlArticleImage extends BaseEntity {
  private Long articleId;

  private Long itemId;

  /** 详情页序号与页内图片位置共同确定顺序，不能依据异步下载完成时间排序。 */
  private int sortOrder;
}
