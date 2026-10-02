package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/** 持久队列同时是结果与失败记录；同任务相同类型/URL 唯一，重启不重新下载已完成文件。 */
@Entity
@Table(
    name = "crawl_item",
    uniqueConstraints = @UniqueConstraint(columnNames = {"task_id", "kind", "url_hash"}))
@Getter
@Setter
public class CrawlItem extends BaseEntity {
  @Column(nullable = false)
  private Long taskId;

  @Column(nullable = false, length = 12)
  private String kind;

  @Column(nullable = false, length = 20)
  private String status = "QUEUED";

  @Column(nullable = false, length = 2000)
  private String url;

  @JsonIgnore
  @Column(nullable = false, length = 64)
  private String urlHash;

  @Column(nullable = false, length = 2000)
  private String rootUrl;

  @Column(length = 2000)
  private String sourceUrl;

  @Column(length = 200)
  private String title;

  private int ordinal;
  private int attempts;
  private Long fileId;

  @Column(length = 64)
  private String digest;

  private long bytes;

  @Column(length = 300)
  private String error;

  @JsonIgnore private Long articleId;

  @JsonIgnore
  @Lob
  @Column(columnDefinition = "mediumtext")
  private String articleBody;

  @JsonIgnore
  @Column(nullable = false)
  private boolean bodyTruncated;
}
