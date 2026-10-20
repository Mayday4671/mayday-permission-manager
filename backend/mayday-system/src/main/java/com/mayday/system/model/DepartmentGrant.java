package com.mayday.system.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import lombok.Data;

/** 某个资源的指定部门授权；与角色一起保存，部门 ID 有数据库外键保护。 */
@Data
public class DepartmentGrant
{
    @NotBlank
    private String resource;

    @NotNull
    private Long departmentId;
}
