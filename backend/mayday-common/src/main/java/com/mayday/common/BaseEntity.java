package com.mayday.common;

import jakarta.persistence.Column;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Version;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 所有业务实体的公共字段。时间由服务端产生，版本号用于防止并发编辑覆盖他人的修改。 */
@Getter
@Setter
@MappedSuperclass
public abstract class BaseEntity {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, updatable = false)
  private LocalDateTime createdAt;

  @Column(nullable = false)
  private LocalDateTime updatedAt;

  /** JPA 在更新提交时递增；API 编辑请求必须携带读取到的版本，禁止把它当作可自由赋值的业务字段。 */
  @Version private Long version;

  /** 首次保存统一生成服务端时间，不能信任客户端传入的创建时间。 */
  @PrePersist
  protected void onCreate() {
    createdAt = LocalDateTime.now();
    updatedAt = createdAt;
  }

  /** 只刷新修改时间；创建时间保持不可变，供历史排序和审计追溯。 */
  @PreUpdate
  protected void onUpdate() {
    updatedAt = LocalDateTime.now();
  }
}
