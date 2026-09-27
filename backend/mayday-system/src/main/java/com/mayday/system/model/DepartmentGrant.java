package com.mayday.system.model;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 某个资源的指定部门授权；与角色一起保存，部门 ID 有数据库外键保护。 */
@Data
@Embeddable
public class DepartmentGrant {
  @NotBlank
  @Column(name = "resource", nullable = false, length = 64)
  private String resource;

  @NotNull
  @Column(name = "department_id", nullable = false)
  private Long departmentId;
}
