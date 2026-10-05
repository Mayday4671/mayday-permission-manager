package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.operations.MessagePublisher;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.model.FlowTask;
import com.mayday.operations.model.Notification;
import com.mayday.operations.realtime.RealtimeEvents;
import com.mayday.operations.realtime.RealtimeStreams;
import com.mayday.operations.repository.DeliveryRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowTaskRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.operations.workflow.WorkflowEvents;
import com.mayday.operations.workflow.WorkflowReminders;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowTemplates;
import com.mayday.security.AccessPolicy;
import com.mayday.security.TokenService;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.persistence.EntityManager;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

/** 覆盖模板可运行性、超时边界、SSE 当前权限与连接配额；真实投递及行锁另外走数据库验收。 */
class RealtimeWorkflowTest {
  @Test
  void templatesAreValidAndTimeoutIsBounded() {
    for (var template : WorkflowTemplates.all()) {
      WorkflowSchema.validate(template.schema());
      for (var field : template.schema().fields()) {
        if ("DATE".equals(field.type())) assertNull(field.maxLength());
        if ("TEXT".equals(field.type())) assertEquals(200, field.maxLength());
        if ("TEXTAREA".equals(field.type())) assertEquals(2000, field.maxLength());
      }
      assertEquals(1440, template.schema().nodes().getFirst().timeoutMinutes());
      var original = template.schema().nodes().getFirst();
      var invalidNode =
          new WorkflowSchema.Node(
              original.id(),
              original.name(),
              original.type(),
              original.next(),
              original.source(),
              original.assigneeIds(),
              original.mode(),
              original.readable(),
              original.writable(),
              original.actions(),
              original.conditions(),
              43201);
      var invalid =
          new WorkflowSchema.Spec(
              template.schema().fields(),
              java.util.List.of(invalidNode, template.schema().nodes().getLast()),
              original.id(),
              "ALL",
              Set.of(),
              false,
              false,
              true);
      assertThrows(BusinessException.class, () -> WorkflowSchema.validate(invalid));
    }
  }

  @Test
  void streamRequiresLiveAccountAndCurrentDomainPermission() {
    TokenService tokens = mock(TokenService.class);
    AccessPolicy access = mock(AccessPolicy.class);
    RealtimeStreams streams = new RealtimeStreams(tokens, access, journal());
    assertThrows(BusinessException.class, () -> streams.open("expired"));
    SysUser user = user(1L);
    when(tokens.authenticate("valid")).thenReturn(Optional.of(user));
    assertThrows(AccessDeniedException.class, () -> streams.open("valid"));
    when(access.hasFor(user, "messages:view")).thenReturn(true);
    streams.open("valid");
    // 权限撤回后，发送事件会关闭已有连接，再次建立同样被拒绝。
    when(access.hasFor(user, "messages:view")).thenReturn(false);
    streams.committed(new RealtimeEvents.Change(Set.of(1L), Set.of("messages")));
    assertThrows(AccessDeniedException.class, () -> streams.open("valid"));
  }

  @Test
  void accountConnectionLimitDoesNotBlockOtherAccounts() {
    TokenService tokens = mock(TokenService.class);
    AccessPolicy access = mock(AccessPolicy.class);
    SysUser first = user(1L), second = user(2L);
    when(tokens.authenticate("first")).thenReturn(Optional.of(first));
    when(tokens.authenticate("second")).thenReturn(Optional.of(second));
    when(access.hasFor(first, "messages:view")).thenReturn(true);
    when(access.hasFor(second, "messages:view")).thenReturn(true);
    RealtimeStreams streams = new RealtimeStreams(tokens, access, journal());
    for (int count = 0; count < 4; count++) streams.open("first");
    assertThrows(BusinessException.class, () -> streams.open("first"));
    streams.open("second");
    when(tokens.authenticate("first")).thenReturn(Optional.empty());
    streams.heartbeat();
    when(tokens.authenticate("first")).thenReturn(Optional.of(first));
    streams.open("first");
  }

  @Test
  void duplicateMessageEventCannotChangeRecipientOrRepublishContent() {
    UserRepository users = mock(UserRepository.class);
    NotificationRepository notifications = mock(NotificationRepository.class);
    DeliveryRepository deliveries = mock(DeliveryRepository.class);
    RealtimeEvents realtime = mock(RealtimeEvents.class);
    when(users.lockById(1L)).thenReturn(Optional.of(user(1L)));
    when(users.lockById(2L)).thenReturn(Optional.of(user(2L)));
    Notification previous = new Notification();
    previous.setId(10L);
    previous.setRecipientIds(Set.of(1L));
    when(notifications.findByEventKey("fixed")).thenReturn(Optional.of(previous));
    MessagePublisher publisher = new MessagePublisher(users, notifications, deliveries, realtime);
    assertEquals(10L, publisher.publish("fixed", 1L, "不能覆盖的标题", "不能覆盖的正文", "测试", "APPROVAL", 20L));
    verify(notifications, never()).saveAndFlush(any());
    verify(deliveries, never()).save(any());
    assertThrows(
        BusinessException.class,
        () -> publisher.publish("fixed", 2L, "标题", "正文", "测试", "APPROVAL", 20L));
  }

  @Test
  void overdueReminderIsOneTimeAndStopsWhenRequestFinishes() {
    FlowTaskRepository tasks = mock(FlowTaskRepository.class);
    FlowRequestRepository requests = mock(FlowRequestRepository.class);
    WorkflowEvents events = mock(WorkflowEvents.class);
    RealtimeEvents realtime = mock(RealtimeEvents.class);
    EntityManager entityManager = mock(EntityManager.class);
    FlowTask task = new FlowTask();
    task.setId(1L);
    task.setRequestId(10L);
    task.setNodeId("review");
    task.setAssigneeId(2L);
    task.setDueAt(BusinessTime.now().minusMinutes(1));
    FlowRequest request = new FlowRequest();
    request.setId(10L);
    request.setApplicantId(2L); // 允许自审时同人不能因 Set.of 重复值而失败。
    request.setCurrentNodeId("review");
    request.setStatus("PENDING");
    when(tasks.findById(1L)).thenReturn(Optional.of(task));
    when(requests.lockById(10L)).thenReturn(Optional.of(request));
    WorkflowReminders reminders =
        new WorkflowReminders(
            tasks,
            requests,
            events,
            entityManager,
            realtime,
            mock(com.mayday.operations.workflow.WorkflowOrchestrator.class));
    reminders.timeout(1L);
    reminders.timeout(1L);
    verify(events, times(1)).enqueue(eq(request), eq(2L), eq("timeout:task:1"), anyString());
    task.setTimeoutNotifiedAt(null);
    request.setStatus("APPROVED");
    reminders.timeout(1L);
    verify(events, times(1)).enqueue(any(), any(), anyString(), anyString());
  }

  private SysUser user(Long id) {
    SysUser user = new SysUser();
    user.setId(id);
    user.setEnabled(true);
    return user;
  }

  /** 测试共享登记契约而不重新引入生产本机配额；实际跨实例配额由双 Java 专项验证。 */
  private static com.mayday.operations.realtime.RealtimeJournal journal() {
    var journal = mock(com.mayday.operations.realtime.RealtimeJournal.class);
    var connections = new java.util.HashMap<String, Long>();
    org.mockito.Mockito.doAnswer(
            call -> {
              String id = call.getArgument(0);
              Long user = call.getArgument(1);
              if (connections.values().stream().filter(user::equals).count() >= 4)
                throw new BusinessException("实时连接数量过多");
              connections.put(id, user);
              return null;
            })
        .when(journal)
        .register(anyString(), anyLong());
    org.mockito.Mockito.doAnswer(
            call -> {
              connections.remove(call.getArgument(0));
              return null;
            })
        .when(journal)
        .remove(anyString());
    when(journal.renew(anyString())).thenReturn(true);
    return journal;
  }
}
