package com.mayday.operations;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.RichText;
import com.mayday.operations.model.Delivery;
import com.mayday.operations.model.Notification;
import com.mayday.operations.realtime.RealtimeEvents;
import com.mayday.operations.repository.DeliveryRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.system.repository.UserRepository;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 业务模块共用的单人站内消息投递。接收者行锁与数据库唯一事件键防止重复；正文仅接收纯文本， 不替调用方进行授权。任务/反馈服务须先验证业务范围，再从业务记录得到接收者和关联编号。 */
@Service
@RequiredArgsConstructor
public class MessagePublisher {
  private final UserRepository users;
  private final NotificationRepository notifications;
  private final DeliveryRepository deliveries;
  private final RealtimeEvents realtime;

  /** eventKey 必须稳定且对每个接收者唯一。重复发布原样返回，不能借重试修改已发布正文。 与调用方业务同事务提交；失败整批回滚，提交成功才推送刷新事件。 */
  @Transactional
  public Long publish(
      String eventKey,
      Long recipientId,
      String title,
      String plainText,
      String senderName,
      String targetType,
      Long targetId) {
    if (eventKey == null
        || eventKey.isBlank()
        || eventKey.length() > 160
        || title == null
        || title.isBlank()
        || title.length() > 160
        || plainText == null
        || plainText.length() > 50_000
        || senderName == null
        || senderName.length() > 64
        || targetType == null
        || targetType.length() > 24) throw new BusinessException("消息参数不完整或超过最大长度");
    var user = users.lockById(recipientId).orElseThrow(() -> new BusinessException("消息接收账号不存在"));
    var previous = notifications.findByEventKey(eventKey).orElse(null);
    if (previous != null) {
      if (!previous.getRecipientIds().equals(Set.of(recipientId)))
        throw new BusinessException("消息事件键已被其他接收者使用");
      return previous.getId();
    }
    Notification notification = new Notification();
    notification.setTitle(title.trim());
    notification.setSummary(plainText.substring(0, Math.min(plainText.length(), 500)));
    notification.setContent(RichText.plain(plainText, 50_000));
    notification.setType("REMINDER");
    notification.setStatus("PUBLISHED");
    notification.setRecipientType("USERS");
    notification.setRecipientIds(Set.of(recipientId));
    notification.setSenderName(senderName);
    notification.setPublishedAt(BusinessTime.now());
    notification.setTargetType(targetType);
    notification.setTargetId(targetId);
    notification.setEventKey(eventKey);
    notifications.saveAndFlush(notification);
    Delivery delivery = new Delivery();
    delivery.setNotification(notification);
    delivery.setRecipientId(recipientId);
    delivery.setRecipientName(user.getNickname());
    deliveries.save(delivery);
    realtime.changed(Set.of(recipientId), "messages");
    return notification.getId();
  }
}
