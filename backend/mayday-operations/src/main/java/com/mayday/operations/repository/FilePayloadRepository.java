package com.mayday.operations.repository;

import com.mayday.operations.model.FilePayload;
import org.springframework.data.jpa.repository.JpaRepository;

/** 历史 MySQL 正文按文件 ID 单条读取，禁止文件列表联查 LOB。 */
public interface FilePayloadRepository extends JpaRepository<FilePayload, Long> {}
