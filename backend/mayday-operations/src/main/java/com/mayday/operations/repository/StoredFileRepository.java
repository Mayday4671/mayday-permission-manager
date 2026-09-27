package com.mayday.operations.repository;

import com.mayday.operations.model.StoredFile;
import org.springframework.data.jpa.repository.*;

/** 文件元信息与字节流同事务保存在 MySQL；响应忽略文件正文，下载走独立鉴权接口。 数据访问层。 */
public interface StoredFileRepository
    extends JpaRepository<StoredFile, Long>, JpaSpecificationExecutor<StoredFile> {}
