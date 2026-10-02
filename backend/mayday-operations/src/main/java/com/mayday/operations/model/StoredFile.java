package com.mayday.operations.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 文件元信息独立于存储实现；历史 MYSQL 文件不需要搬迁即可继续读取。 外部对象键从不返回客户端，所有读取仍经过业务鉴权接口。 */
@Getter
@Setter
@Entity
@Table(name = "ops_file")
public class StoredFile extends BaseEntity {
  @Column(nullable = false, length = 255)
  private String name;

  @Column(nullable = false, length = 128)
  private String contentType;

  private long size;
  private Long ownerId;

  @Column(length = 64)
  private String ownerName;

  /** null 表示用户的根目录；目录只改变组织方式，不改变文件的所有者权限。 */
  private Long directoryId;

  @Column(nullable = false, length = 16)
  private String storageProvider = "MYSQL";

  @JsonIgnore
  @Column(length = 512)
  private String storageKey;

  @JsonIgnore
  @Column(length = 512)
  private String thumbnailKey;

  /** 回收文件保留正文，业务引用的文件禁止进入此状态。 */
  private LocalDateTime deletedAt;

  /** 永久删除先记录意图，再由可重试任务清理正文，避免数据库回滚损坏在用附件。 */
  private LocalDateTime purgeRequestedAt;

  @Column(length = 300)
  private String purgeError;
}
