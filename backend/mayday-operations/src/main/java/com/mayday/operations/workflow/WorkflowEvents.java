package com.mayday.operations.workflow;

import com.mayday.common.BusinessTime;
import com.mayday.operations.MessagePublisher;
import com.mayday.operations.model.BusinessEvent;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.repository.BusinessEventRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.system.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 事件与业务同事务落库，异步投递只读取已提交事件。 消息批次 eventKey、单人投递唯一键与事件行锁三层幂等；失败事务回滚后再记录重试时间。 */
@Service
@RequiredArgsConstructor
public class WorkflowEvents {
  private final BusinessEventRepository events;
  private final NotificationRepository notifications;
  private final UserRepository users;
  private final MessagePublisher publisher;
  private final WorkflowPrivateDrafts privateDrafts;

  /** 调用方必须处于业务事务；事件键稳定且唯一，事件不存储敏感表单值。 */
  @Transactional(propagation = Propagation.MANDATORY)
  public void enqueue(FlowRequest request, Long recipientId, String key, String text) {
    if (events.existsByEventKey(key)) return;
    var event = new BusinessEvent();
    event.setRequestId(request.getId());
    event.setRecipientId(recipientId);
    event.setEventKey(key);
    // 通知面向审批参与者，旧库私人标题覆盖也必须与详情采用相同安全读取边界。
    String submittedTitle = privateDrafts.title(request, false);
    String title = "审批通知 · " + submittedTitle;
    event.setTitle(title.substring(0, Math.min(title.length(), 160)));
    event.setBody(text + "：" + submittedTitle);
    events.save(event);
  }

  /** 每次锁住一条事件，将发布与投递同事务完成；已提交事件不会重复生成站内消息。 */
  @Transactional
  public void deliver(Long id) {
    var event = events.lockById(id).orElse(null);
    if (event == null
        || !"PENDING".equals(event.getStatus())
        || event.getNextAttemptAt().isAfter(BusinessTime.now())) return;
    if (notifications.findByEventKey(event.getEventKey()).isPresent()) {
      event.setStatus("DELIVERED");
      return;
    }
    var user = users.findById(event.getRecipientId()).orElse(null);
    // 已被删除的接收者无法投递，明确终结事件；停用账号保留收件，重新启用后仍按页面权限读取。
    if (user == null) {
      event.setStatus("SKIPPED");
      event.setLastError("接收账号已删除");
      return;
    }
    publisher.publish(
        event.getEventKey(),
        user.getId(),
        event.getTitle(),
        event.getBody(),
        "审批中心",
        "APPROVAL",
        event.getRequestId());
    event.setStatus("DELIVERED");
    event.setLastError(null);
  }

  /** 投递事务已回滚后用新事务记录指数退避，避免把数据库异常原文或账号资料写进页面。 */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void failed(Long id) {
    var event = events.lockById(id).orElse(null);
    if (event == null || !"PENDING".equals(event.getStatus())) return;
    event.setAttempts(Math.min(event.getAttempts() + 1, 10000));
    event.setNextAttemptAt(
        BusinessTime.now().plusSeconds(Math.min(3600, 1L << Math.min(12, event.getAttempts()))));
    event.setLastError("投递暂时失败，系统将自动重试");
  }
}
