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
    /** 目录展示名称；同一所有者及父目录下唯一，不参与本地文件路径拼接 */

    private String name;
    /** 父目录ID；0表示根目录，服务端验证同一所有者和无循环关系 */

    private Long parentId = 0L;
    /** 目录所有者账号ID，来源于有效服务端会话，不接受客户端指定所有者 */

    private Long ownerId;
    /** 创建时所有者展示名，仅作历史展示，不作为授权依据 */

    private String ownerName;
}
