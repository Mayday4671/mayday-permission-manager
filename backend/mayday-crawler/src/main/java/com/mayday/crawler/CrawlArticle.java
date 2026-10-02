package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/** 每个任务内一个分页组对应一篇文章；正文按页保存在队列项，重试不会重复拼接正文。 */
@Entity
@Table(
    name = "crawl_article",
    uniqueConstraints = @UniqueConstraint(columnNames = {"task_id", "source_hash"}))
@Getter
@Setter
public class CrawlArticle extends BaseEntity {
  @Column(nullable = false)
  private Long taskId;

  @Column(nullable = false, length = 2000)
  private String sourceUrl;

  @JsonIgnore
  @Column(nullable = false, length = 64)
  private String sourceHash;

  @Column(nullable = false, length = 200)
  private String title;

  @Column(nullable = false, length = 300)
  private String summary = "";

  @Column(nullable = false, length = 100)
  private String author = "";

  @Column(nullable = false, length = 100)
  private String publishedAt = "";
}
