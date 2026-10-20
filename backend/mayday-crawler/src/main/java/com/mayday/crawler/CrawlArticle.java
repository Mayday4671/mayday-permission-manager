package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 每个任务内一个分页组对应一篇文章；正文按页保存在队列项，重试不会重复拼接正文。 */
@Getter
@Setter
@Table(
    value = "crawl_article",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlArticle extends BaseEntity {
  private Long taskId;

  private String sourceUrl;

  @JsonIgnore private String sourceHash;

  private String title;

  private String summary = "";

  private String author = "";

  /** 来源站点的日期文本，不强制猜测时区；采集时间由 BaseEntity.createdAt 单独记录。 */
  private String publishedAt = "";
}
