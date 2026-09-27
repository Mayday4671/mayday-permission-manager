package com.mayday.operations.workflow;

import com.mayday.common.RichText;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.system.repository.UserRepository;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** 事件与业务同事务落库，异步投递只读取已提交事件。 消息批次 eventKey、单人投递唯一键与事件行锁三层幂等；失败事务回滚后再记录重试时间。 */
@Service
@RequiredArgsConstructor
public class WorkflowEvents {
  private final BusinessEventRepository events;
  private final NotificationRepository notifications;
  private final DeliveryRepository deliveries;
  private final UserRepository users;

  @Transactional(propagation = Propagation.MANDATORY)
  public void enqueue(FlowRequest r, Long recipient, String key, String text) {
    if (events.existsByEventKey(key)) return;
    var e = new BusinessEvent();
    e.setRequestId(r.getId());
    e.setRecipientId(recipient);
    e.setEventKey(key);
    String title = "审批通知 · " + r.getTitle();
    e.setTitle(title.substring(0, Math.min(title.length(), 160)));
    e.setBody(text + "：" + r.getTitle());
    events.save(e);
  }

  @Transactional
  public void deliver(Long id) {
    var e = events.lockById(id).orElse(null);
    if (e == null
        || !"PENDING".equals(e.getStatus())
        || e.getNextAttemptAt().isAfter(LocalDateTime.now())) return;
    if (notifications.findByEventKey(e.getEventKey()).isPresent()) {
      e.setStatus("DELIVERED");
      return;
    }
    var user = users.findById(e.getRecipientId()).orElse(null);
    // 已被删除的接收者无法投递，明确终结事件；停用账号保留收件，重新启用后仍按页面权限读取。
    if (user == null) {
      e.setStatus("SKIPPED");
      e.setLastError("接收账号已删除");
      return;
    }
    var n = new Notification();
    n.setTitle(e.getTitle());
    n.setSummary(e.getBody());
    n.setContent(RichText.plain(e.getBody(), 50000));
    n.setType("REMINDER");
    n.setStatus("PUBLISHED");
    n.setRecipientType("USERS");
    n.setRecipientIds(java.util.Set.of(user.getId()));
    n.setSenderName("审批中心");
    n.setPublishedAt(LocalDateTime.now());
    n.setTargetType("APPROVAL");
    n.setTargetId(e.getRequestId());
    n.setEventKey(e.getEventKey());
    notifications.saveAndFlush(n);
    var delivery = new Delivery();
    delivery.setNotification(n);
    delivery.setRecipientId(user.getId());
    delivery.setRecipientName(user.getNickname());
    deliveries.save(delivery);
    e.setStatus("DELIVERED");
    e.setLastError(null);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void failed(Long id) {
    var e = events.lockById(id).orElse(null);
    if (e == null || !"PENDING".equals(e.getStatus())) return;
    e.setAttempts(Math.min(e.getAttempts() + 1, 10000));
    e.setNextAttemptAt(
        LocalDateTime.now().plusSeconds(Math.min(3600, 1L << Math.min(12, e.getAttempts()))));
    e.setLastError("投递暂时失败，系统将自动重试");
  }
}
