package com.mayday.operations.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 历史 MYSQL 文件正文的兼容存储；新上传采用配置的本地或对象存储，列表不加载正文。 */
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
