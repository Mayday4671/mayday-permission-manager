package com.mayday.operations.repository;

import com.mayday.operations.model.Delivery;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** 已读更新在 SQL 内附带收件人和未读条件，重复请求与并发请求均不会覆盖第一次阅读时间。 */
public interface DeliveryRepository
    extends JpaRepository<Delivery, Long>, JpaSpecificationExecutor<Delivery> {
  /** 撤回后只发送缓存失效事件，不发送通知正文。 */
  java.util.List<Delivery> findByNotificationId(Long notificationId);

  long countByNotificationId(Long notificationId);

  long countByNotificationIdAndReadAtIsNotNull(Long notificationId);

  @Modifying(clearAutomatically = true)
  @Query(
      "update Delivery d set d.readAt=:now,d.updatedAt=:now,d.version=d.version+1 where d.id=:id"
          + " and d.recipientId=:userId and d.readAt is null")
  int markRead(Long id, Long userId, LocalDateTime now);

  @Modifying(clearAutomatically = true)
  @Query(
      "update Delivery d set d.readAt=:now,d.updatedAt=:now,d.version=d.version+1 where"
          + " d.recipientId=:userId and d.readAt is null and d.notification.id in (select n.id from"
          + " Notification n where n.status='PUBLISHED' and (n.expiresAt is null or"
          + " n.expiresAt>:now))")
  int markAllRead(Long userId, LocalDateTime now);

  void deleteByNotificationId(Long notificationId);
}
