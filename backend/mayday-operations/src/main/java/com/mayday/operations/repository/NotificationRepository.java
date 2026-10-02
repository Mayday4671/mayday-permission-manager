package com.mayday.operations.repository;

import com.mayday.operations.model.Notification;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 发布、撤回及编辑共用行锁；乐观版本检查仍用于拒绝过时表单。 */
public interface NotificationRepository
    extends JpaRepository<Notification, Long>, JpaSpecificationExecutor<Notification> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select n from Notification n where n.id=:id")
  Optional<Notification> lockById(Long id);

  boolean existsByAttachmentIdsContains(Long fileId);

  Optional<Notification> findByEventKey(String eventKey);
}
