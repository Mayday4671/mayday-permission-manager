package com.mayday.bulk;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 批量作业的最小持久化状态；导入密码不入库，导出正文写到受控临时目录。 */
@Getter
@Setter
@Entity
@Table(name = "sys_bulk_job")
public class BulkJob extends BaseEntity {
  @Column(nullable = false)
  private Long ownerId;

  @Column(nullable = false, length = 64)
  private String resource;

  @Column(nullable = false, length = 16)
  private String kind = "EXPORT";

  @Column(nullable = false, length = 16)
  private String status = "QUEUED";

  @Column(nullable = false)
  private int processedRows;

  @Column(nullable = false)
  private long totalRows;

  @Column(columnDefinition = "TEXT")
  private String queryJson;

  @Column(nullable = false, length = 64)
  private String permissionSignature;

  @Column(length = 64)
  private String resultKey;

  @Column(length = 64)
  private String idempotencyKey;

  @Column(length = 64)
  private String inputChecksum;

  @Column(length = 500)
  private String failure;

  @Column(nullable = false)
  private LocalDateTime expiresAt;

  /** 保证 API 与内部存储字段隔离，后续存储迁移不会把服务端路径变成公共接口契约。 */
  public BulkContracts.JobView view() {
    return new BulkContracts.JobView(
        getId(),
        resource,
        BulkContracts.Kind.valueOf(kind),
        BulkContracts.Status.valueOf(status),
        processedRows,
        totalRows,
        failure,
        getCreatedAt(),
        expiresAt);
  }
}
