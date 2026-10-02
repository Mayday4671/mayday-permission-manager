package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 规则随任务保存；开始后禁止原地修改，防止续跑时混用不同的分页语义。 */
@Entity
@Table(name = "crawl_task")
@Getter
@Setter
public class CrawlTask extends BaseEntity {
  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false)
  private Long ownerId;

  @Column(nullable = false, length = 64)
  private String ownerName;

  /** 实际点击运行的账号；领取和提交结果都重新检查这个账号的实时授权。 */
  private Long runnerId;

  @Column(nullable = false, length = 20)
  private String status = "DRAFT";

  /** 已产生文章的配置删除后仅归档；保留来源和所有者供独立数据查询授权，不再显示或执行配置。 */
  @JsonIgnore
  @Column(nullable = false)
  private boolean archived;

  @Column(nullable = false, columnDefinition = "text")
  @JsonIgnore
  private String rulesJson;

  /** 每次领取生成新租约，停止、到期或重领后旧工作器的结果会被拒绝。 */
  @JsonIgnore
  @Column(length = 36)
  private String leaseToken;

  @JsonIgnore private LocalDateTime leaseUntil;
  private LocalDateTime nextFetchAt;

  @Column(length = 300)
  private String lastError;

  private int pageCount;
  private int imageCount;
  private int failedCount;
  private long totalBytes;

  /** 对外展示解析后的受控规则；原始 JSON 和执行租约不会序列化到客户端。 */
  public CrawlRules getRules() {
    return CrawlRules.parse(rulesJson);
  }
}
