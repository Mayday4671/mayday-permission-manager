package com.mayday.operations.model;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 历史 MYSQL 文件正文的兼容存储；新上传采用配置的本地或对象存储，列表不加载正文。 */
@Getter
@Setter
@Table("ops_file_payload")
public class FilePayload
{
    /** 与文件元信息表共享主键；正文的存活期由文件删除流程统一管理。 */
    @Id(keyType = KeyType.Auto)
    private Long id;

    private byte[] data;
}
