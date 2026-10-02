package com.mayday.operations.repository;

import com.mayday.operations.model.FileDirectory;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 目录树查询限制条数；移动和删除锁定目标目录，防止上传与目录删除的竞态。 */
public interface FileDirectoryRepository extends JpaRepository<FileDirectory, Long> {
  List<FileDirectory> findTop500ByOwnerIdOrderByNameAsc(Long ownerId);

  List<FileDirectory> findTop500ByOrderByNameAsc();

  boolean existsByParentId(Long parentId);

  boolean existsByOwnerIdAndParentIdAndNameAndIdNot(
      Long ownerId, Long parentId, String name, Long id);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select directory from FileDirectory directory where directory.id = :id")
  Optional<FileDirectory> lock(@Param("id") Long id);
}
