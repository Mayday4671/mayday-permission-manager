package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 文件元信息与字节流同事务保存在 MySQL；响应忽略文件正文，下载走独立鉴权接口。 */
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
}
