package com.mayday.operations.repository;

import com.mayday.operations.model.StoredFile;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 仅查询元信息；修改、回收和清理以行锁串行化，防止并发恢复与永久删除交错。 */
public interface StoredFileRepository
    extends JpaRepository<StoredFile, Long>, JpaSpecificationExecutor<StoredFile> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select file from StoredFile file where file.id = :id")
  Optional<StoredFile> lock(@Param("id") Long id);

  boolean existsByDirectoryId(Long directoryId);

  List<StoredFile> findTop10ByPurgeRequestedAtIsNotNullOrderByPurgeRequestedAtAsc();
}
