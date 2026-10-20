package com.mayday.operations.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 用户文件目录。根目录用 parentId=0 表示，使同级名称唯一约束也能覆盖根目录。 */
@Getter
@Setter
@Table(value = "ops_file_directory", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class FileDirectory extends BaseEntity
{
    private String name;

    private Long parentId = 0L;

    private Long ownerId;

    private String ownerName;
}
