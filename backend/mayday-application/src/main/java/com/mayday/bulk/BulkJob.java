package com.mayday.bulk;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 批量作业的最小持久化状态；导入密码不入库，导出临时文件本机生成、成功正文共享持久保存。 */
@Getter
@Setter
@Table(
    value = "sys_bulk_job",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class BulkJob extends BaseEntity {
  private Long ownerId;
  private String resource;
  private String kind = "EXPORT";
  private String status = "QUEUED";
  private int processedRows;
  private long totalRows;
  private String queryJson;
  private String permissionSignature;
  private String resultKey;
  private String idempotencyKey;
  private String inputChecksum;
  private String failure;
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
