package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 用户文件目录。根目录用 parentId=0 表示，使同级名称唯一约束也能覆盖根目录。 */
@Getter
@Setter
@Entity
@Table(name = "ops_file_directory")
public class FileDirectory extends BaseEntity {
  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false)
  private Long parentId = 0L;

  @Column(nullable = false)
  private Long ownerId;

  @Column(length = 64)
  private String ownerName;
}
