package com.mayday.crawler;
import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/** 图片队列在同任务去重，但文章引用独立保存，防止相同图片在另一篇文章中消失。 */
@Entity @Table(name="crawl_article_image",uniqueConstraints=@UniqueConstraint(columnNames={"article_id","item_id"})) @Getter @Setter
public class CrawlArticleImage extends BaseEntity {
  @Column(nullable=false) private Long articleId;
  @Column(nullable=false) private Long itemId;
  @Column(nullable=false) private int sortOrder;
}
