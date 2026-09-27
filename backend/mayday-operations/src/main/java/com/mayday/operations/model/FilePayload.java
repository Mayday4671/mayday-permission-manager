package com.mayday.operations.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** 文件字节独立存储，列表查询不会把所有文件正文载入内存。 */
@Entity
@Table(name = "ops_file_payload")
@Getter
@Setter
public class FilePayload {
  @Id private Long id;

  @Lob
  @Column(nullable = false, columnDefinition = "longblob")
  private byte[] data;
}
