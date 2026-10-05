package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.ModuleSwitches;
import com.mayday.operations.MessagePublisher;
import com.mayday.operations.model.JobExecution;
import com.mayday.operations.model.ScheduledJob;
import com.mayday.operations.monitor.MonitorPolicy;
import com.mayday.operations.monitor.MonitorPolicyRepository;
import com.mayday.operations.monitor.MonitorSample;
import com.mayday.operations.monitor.MonitorSampleRepository;
import com.mayday.operations.monitor.MonitorService;
import com.mayday.operations.repository.JobExecutionRepository;
import com.mayday.operations.repository.ScheduledJobRepository;
import com.mayday.operations.service.JobHandler;
import com.mayday.operations.service.JobRunner;
import com.mayday.security.AccessPolicy;
import com.mayday.service.ChangeAuditService;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import java.sql.Connection;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.SmartTransactionObject;
import org.springframework.transaction.support.TransactionTemplate;

/** 平台通用能力的失败边界；HTTP 权限、持久化结果与版本冲突由独立 MySQL 验收补充。 */
class GeneralPlatformTest {
  /** 审计差异排序稳定，未改字段不制造噪声，返回列表不能被后续代码修改。 */
  @Test
  void changeAuditDifferencesAreStableAndDoNotKeepUnchangedFields() {
    var differences =
        ChangeAuditService.differences(
            Map.of("zeta", 1, "alpha", "old", "unchanged", true),
            Map.of("alpha", "new", "zeta", 2, "unchanged", true));
    assertEquals(
        List.of("alpha", "zeta"),
        differences.stream().map(ChangeAuditService.Difference::field).toList());
    assertEquals("old", differences.getFirst().before());
    assertEquals("new", differences.getFirst().after());
    assertEquals(
        "—", ChangeAuditService.differences(Map.of(), Map.of("enabled", true)).getFirst().before());
    assertThrows(UnsupportedOperationException.class, () -> differences.clear());
  }

  /** 即使调用方误传秘密字段也在保存前拒绝，不允许先泄露后依赖页面隐藏。 */
  @Test
  void changeAuditRejectsCredentialsContactsAndBodies() {
    for (String field :
        List.of(
            "passwordHash",
            "accessToken",
            "secret",
            "EMAIL",
            "phone",
            "正文",
            "密码",
            "令牌",
            "邮箱",
            "电话")) {
      assertThrows(
          IllegalArgumentException.class,
          () -> ChangeAuditService.differences(Map.of(), Map.of(field, "sensitive")),
          field);
    }
  }

  /** 业务失败先回滚，失败记录单独提交，随后提醒投递失败也不能抹掉已经提交的 FAILED 结果。 */
  @Test
  void jobFailureIsCommittedBeforeNotificationFailure() {
    ScheduledJobRepository jobs = mock(ScheduledJobRepository.class);
    JobExecutionRepository executions = mock(JobExecutionRepository.class);
    MessagePublisher messages = mock(MessagePublisher.class);
    AccessPolicy access = mock(AccessPolicy.class);
    UserRepository users = mock(UserRepository.class);
    PlatformTransactionManager transactions = transactions();
    JobHandler handler = mock(JobHandler.class);
    when(handler.key()).thenReturn("FAIL_TEST");
    when(handler.execute()).thenThrow(new IllegalStateException("password=must-not-leak"));
    when(handler.execute(any(JobHandler.Context.class)))
        .thenAnswer(invocation -> handler.execute());
    ScheduledJob job = new ScheduledJob();
    job.setId(1L);
    job.setName("失败边界检查");
    job.setHandler("FAIL_TEST");
    job.setCron("0 */5 * * * *");
    job.setEnabled(true);
    job.setNextRunAt(BusinessTime.now().minusMinutes(1));
    job.setAlertUserId(2L);
    SysUser recipient = new SysUser();
    recipient.setId(2L);
    when(jobs.lock(1L)).thenReturn(Optional.of(job));
    when(jobs.findById(1L)).thenReturn(Optional.of(job));
    when(users.findById(2L)).thenReturn(Optional.of(recipient));
    when(access.hasFor(recipient, "scheduler:view")).thenReturn(true);
    when(executions.saveAndFlush(any(JobExecution.class)))
        .thenAnswer(
            invocation -> {
              JobExecution saved = invocation.getArgument(0);
              saved.setId(71L);
              when(executions.lock(71L)).thenReturn(Optional.of(saved));
              return saved;
            });
    when(messages.publish(
            anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyLong()))
        .thenThrow(new BusinessException("提醒暂时不可用"));
    JobRunner runner =
        new JobRunner(
            jobs,
            executions,
            messages,
            new ModuleSwitches(),
            transactions,
            List.of(handler),
            access,
            users,
            durable(transactions),
            tools.jackson.databind.json.JsonMapper.builder().build());
    JobExecution failed = runner.run(1L, true);
    assertEquals("FAILED", failed.getStatus());
    assertEquals(71L, failed.getId());
    assertFalse(failed.getResult().contains("password"));
    assertNull(failed.getFailureNotifiedAt(), "失败投递必须仍留在重试队列");
    assertTrue(job.getNextRunAt().isAfter(BusinessTime.now()));
    var order = inOrder(transactions, executions, messages);
    order.verify(transactions).rollback(any(TransactionStatus.class));
    order.verify(executions).saveAndFlush(any(JobExecution.class));
    order.verify(transactions).commit(any(TransactionStatus.class));
    order
        .verify(messages)
        .publish(
            anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyLong());
    order.verify(transactions).rollback(any(TransactionStatus.class));
    verify(executions, never()).save(any(JobExecution.class));
    ArgumentCaptor<TransactionDefinition> definitions =
        ArgumentCaptor.forClass(TransactionDefinition.class);
    verify(transactions, times(6)).getTransaction(definitions.capture());
    assertTrue(
        definitions.getAllValues().stream()
            .allMatch(
                definition ->
                    definition.getPropagationBehavior()
                        == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
  }

  /** 扩展用例即使已有外层事务，执行失败与失败记录仍各自隔离，外层随后回滚也不能丢失已提交失败证据。 */
  @Test
  void jobFailureHistorySurvivesAnOuterTransactionRollback() {
    ScheduledJobRepository jobs = mock(ScheduledJobRepository.class);
    JobExecutionRepository executions = mock(JobExecutionRepository.class);
    TransactionProbe transactions = new TransactionProbe();
    JobHandler handler = mock(JobHandler.class);
    when(handler.key()).thenReturn("FAIL_TEST");
    when(handler.execute()).thenThrow(new BusinessException("业务处理失败"));
    when(handler.execute(any(JobHandler.Context.class)))
        .thenAnswer(invocation -> handler.execute());
    ScheduledJob job = new ScheduledJob();
    job.setId(1L);
    job.setName("外层事务隔离检查");
    job.setHandler("FAIL_TEST");
    job.setCron("0 */5 * * * *");
    when(jobs.lock(1L)).thenReturn(Optional.of(job));
    when(jobs.findById(1L)).thenReturn(Optional.of(job));
    when(executions.saveAndFlush(any(JobExecution.class)))
        .thenAnswer(
            invocation -> {
              JobExecution saved = invocation.getArgument(0);
              saved.setId(72L);
              when(executions.lock(72L)).thenReturn(Optional.of(saved));
              if ("FAILED".equals(saved.getStatus())) transactions.stageFailure(saved.getId());
              return saved;
            });
    JobRunner runner =
        new JobRunner(
            jobs,
            executions,
            mock(MessagePublisher.class),
            new ModuleSwitches(),
            transactions,
            List.of(handler),
            mock(AccessPolicy.class),
            mock(UserRepository.class),
            durable(transactions),
            tools.jackson.databind.json.JsonMapper.builder().build());
    assertThrows(
        BusinessException.class,
        () ->
            new TransactionTemplate(transactions)
                .executeWithoutResult(
                    status -> {
                      assertEquals("FAILED", runner.run(1L, true).getStatus());
                      assertFalse(status.isRollbackOnly(), "处理器故障不应污染扩展用例的外层事务");
                      assertTrue(transactions.committedFailures.contains(72L));
                      throw new BusinessException("外层用例随后回滚");
                    }));
    assertEquals(Set.of(72L), transactions.committedFailures);
    assertEquals(
        List.of(
            TransactionDefinition.PROPAGATION_REQUIRED,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW,
            TransactionDefinition.PROPAGATION_REQUIRES_NEW),
        transactions.propagations);
  }

  /** 完成投递的执行记录退出扫描队列，即使另一节点已取得旧候选列表，行锁内重查也不重复发布。 */
  @Test
  void failureRetryMarksDeliveryCompleteAndRejectsStaleCandidates() {
    ScheduledJobRepository jobs = mock(ScheduledJobRepository.class);
    JobExecutionRepository executions = mock(JobExecutionRepository.class);
    MessagePublisher messages = mock(MessagePublisher.class);
    AccessPolicy access = mock(AccessPolicy.class);
    UserRepository users = mock(UserRepository.class);
    ScheduledJob job = new ScheduledJob();
    job.setId(1L);
    job.setAlertUserId(2L);
    SysUser recipient = new SysUser();
    recipient.setId(2L);
    JobExecution failure = new JobExecution();
    failure.setId(73L);
    failure.setJobId(1L);
    failure.setJobName("补发失败提醒检查");
    failure.setStatus("FAILED");
    when(jobs.findById(1L)).thenReturn(Optional.of(job));
    when(users.findById(2L)).thenReturn(Optional.of(recipient));
    when(access.hasFor(recipient, "scheduler:view")).thenReturn(true);
    when(executions.lock(73L)).thenReturn(Optional.of(failure));
    // 刻意两次返回同一旧候选，模拟并发扫描者已经取得的数据，不依赖仓库过滤来掩盖重复发布。
    when(executions.findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
            anyString(), any(LocalDateTime.class)))
        .thenReturn(List.of(failure));
    JobRunner runner =
        new JobRunner(
            jobs,
            executions,
            messages,
            new ModuleSwitches(),
            transactions(),
            List.of(),
            access,
            users,
            durable(transactions()),
            tools.jackson.databind.json.JsonMapper.builder().build());
    runner.retryFailureNotifications();
    assertNotNull(failure.getFailureNotifiedAt());
    runner.retryFailureNotifications();
    verify(messages)
        .publish(
            "scheduler:failure:73", 2L, "调度执行失败", "补发失败提醒检查执行失败，请查看执行记录。", "任务调度", "SCHEDULER", 1L);
    verify(executions, times(2))
        .findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
            anyString(), any(LocalDateTime.class));
  }

  /** 未配置、已删除或已撤销权限的接收人明确跳过历史提醒，不无限占据队列，也不向无权账号投递。 */
  @Test
  void failureRetrySkipsUnavailableRecipientsWithoutNotification() {
    for (String recipientState : List.of("NONE", "DELETED", "REVOKED")) {
      ScheduledJobRepository jobs = mock(ScheduledJobRepository.class);
      JobExecutionRepository executions = mock(JobExecutionRepository.class);
      MessagePublisher messages = mock(MessagePublisher.class);
      UserRepository users = mock(UserRepository.class);
      PlatformTransactionManager transactions = transactions();
      ScheduledJob job = new ScheduledJob();
      job.setId(1L);
      if (!"NONE".equals(recipientState)) job.setAlertUserId(2L);
      JobExecution failure = new JobExecution();
      failure.setId(74L);
      failure.setJobId(1L);
      failure.setStatus("FAILED");
      when(jobs.findById(1L)).thenReturn(Optional.of(job));
      when(executions.lock(74L)).thenReturn(Optional.of(failure));
      when(executions.findTop100ByStatusAndFailureNotifiedAtIsNullAndCreatedAtAfterOrderByIdAsc(
              anyString(), any(LocalDateTime.class)))
          .thenReturn(List.of(failure));
      when(users.findById(2L))
          .thenReturn(
              "DELETED".equals(recipientState) ? Optional.empty() : Optional.of(new SysUser()));
      new JobRunner(
              jobs,
              executions,
              messages,
              new ModuleSwitches(),
              transactions,
              List.of(),
              mock(AccessPolicy.class),
              users,
              durable(transactions),
              tools.jackson.databind.json.JsonMapper.builder().build())
          .retryFailureNotifications();
      assertNotNull(failure.getFailureNotifiedAt(), recipientState);
      verify(transactions).commit(any(TransactionStatus.class));
      verify(messages, never())
          .publish(
              anyString(),
              anyLong(),
              anyString(),
              anyString(),
              anyString(),
              anyString(),
              anyLong());
    }
  }

  /** 接收账号已经删除或失去查看权限时，仍要保存健康数据库下的采样，并且不发送越权提醒。 */
  @Test
  void monitorKeepsSamplingWhenRecipientIsNoLongerAuthorized() throws Exception {
    for (boolean deleted : List.of(false, true)) {
      MonitorSampleRepository samples = mock(MonitorSampleRepository.class);
      MonitorPolicyRepository policies = mock(MonitorPolicyRepository.class);
      DataSource dataSource = mock(DataSource.class);
      Connection connection = mock(Connection.class);
      AccessPolicy access = mock(AccessPolicy.class);
      UserRepository users = mock(UserRepository.class);
      MessagePublisher messages = mock(MessagePublisher.class);
      PlatformTransactionManager transactions = transactions();
      when(dataSource.getConnection()).thenReturn(connection);
      when(connection.isValid(3)).thenReturn(true);
      MonitorPolicy policy = new MonitorPolicy();
      policy.setEnabled(true);
      policy.setAlertUserId(2L);
      when(policies.lock()).thenReturn(Optional.of(policy));
      when(users.findById(2L)).thenReturn(deleted ? Optional.empty() : Optional.of(new SysUser()));
      MonitorService monitor =
          new MonitorService(
              samples,
              policies,
              dataSource,
              access,
              users,
              messages,
              new ModuleSwitches(),
              transactions);
      monitor.collect();
      ArgumentCaptor<MonitorSample> captured = ArgumentCaptor.forClass(MonitorSample.class);
      verify(samples).save(captured.capture());
      assertTrue(captured.getValue().isDatabaseHealthy());
      assertNotNull(captured.getValue().getNodeId());
      verify(samples).deleteByCreatedAtBefore(any(LocalDateTime.class));
      verify(transactions, atLeastOnce()).commit(any(TransactionStatus.class));
      verify(transactions, never()).rollback(any(TransactionStatus.class));
      verify(messages, never())
          .publish(
              anyString(),
              anyLong(),
              anyString(),
              anyString(),
              anyString(),
              anyString(),
              anyLong());
    }
  }

  /** 告警发送异常发生在正常采样提交之后，不能回滚曲线或提前进入30分钟冷却。 */
  @Test
  void monitorCommitsSampleBeforeFailedAlertAndDoesNotConsumeCooldown() {
    MonitorSampleRepository samples = mock(MonitorSampleRepository.class);
    MonitorPolicyRepository policies = mock(MonitorPolicyRepository.class);
    AccessPolicy access = mock(AccessPolicy.class);
    UserRepository users = mock(UserRepository.class);
    MessagePublisher messages = mock(MessagePublisher.class);
    PlatformTransactionManager transactions = transactions();
    MonitorPolicy policy = new MonitorPolicy();
    policy.setEnabled(true);
    policy.setHeapThresholdPercent(80);
    policy.setDatabaseThresholdMs(500);
    policy.setAlertUserId(2L);
    SysUser recipient = new SysUser();
    recipient.setId(2L);
    when(policies.lock()).thenReturn(Optional.of(policy));
    when(users.findById(2L)).thenReturn(Optional.of(recipient));
    when(access.hasFor(recipient, "monitor:view")).thenReturn(true);
    when(messages.publish(
            anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyLong()))
        .thenAnswer(
            invocation -> {
              assertNull(policy.getLastAlertAt(), "提醒未投递时不能提前消耗冷却窗口");
              throw new BusinessException("消息服务暂时不可用");
            });
    MonitorService monitor =
        spy(
            new MonitorService(
                samples,
                policies,
                mock(DataSource.class),
                access,
                users,
                messages,
                new ModuleSwitches(),
                transactions));
    doReturn(
            new MonitorService.Snapshot(
                BusinessTime.now(), 1000, "21", 4, 10, 90, 100, 100, true, 20, "test", "UTC", 5))
        .when(monitor)
        .sample();
    monitor.collect();
    var order = inOrder(samples, transactions, messages);
    order.verify(samples).save(any(MonitorSample.class));
    order.verify(transactions).commit(any(TransactionStatus.class));
    order
        .verify(messages)
        .publish(
            anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyLong());
    order.verify(transactions).rollback(any(TransactionStatus.class));
    assertNull(policy.getLastAlertAt());
    ArgumentCaptor<TransactionDefinition> definitions =
        ArgumentCaptor.forClass(TransactionDefinition.class);
    verify(transactions, times(2)).getTransaction(definitions.capture());
    assertTrue(
        definitions.getAllValues().stream()
            .allMatch(
                definition ->
                    definition.getPropagationBehavior()
                        == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
  }

  /** 用 Spring 真实传播规则模拟提交与回滚，只暂存失败记录编号，不冒充数据库或跨节点验收。 */
  private static final class TransactionProbe extends AbstractPlatformTransactionManager {
    private TransactionUnit current;
    private final Set<Long> committedFailures = new HashSet<>();
    private final List<Integer> propagations = new ArrayList<>();

    private void stageFailure(Long id) {
      assertNotNull(current, "失败记录必须在事务中保存");
      current.pendingFailures.add(id);
    }

    @Override
    protected Object doGetTransaction() {
      return new TransactionHolder(current);
    }

    @Override
    protected boolean isExistingTransaction(Object transaction) {
      TransactionUnit unit = ((TransactionHolder) transaction).unit;
      return unit != null && unit.active;
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
      propagations.add(definition.getPropagationBehavior());
      current = new TransactionUnit();
      ((TransactionHolder) transaction).unit = current;
    }

    @Override
    protected Object doSuspend(Object transaction) {
      TransactionUnit suspended = current;
      current = null;
      ((TransactionHolder) transaction).unit = null;
      return suspended;
    }

    @Override
    protected void doResume(Object transaction, Object suspendedResources) {
      current = (TransactionUnit) suspendedResources;
      if (transaction != null) ((TransactionHolder) transaction).unit = current;
    }

    @Override
    protected void doCommit(DefaultTransactionStatus status) {
      committedFailures.addAll(((TransactionHolder) status.getTransaction()).unit.pendingFailures);
    }

    @Override
    protected void doRollback(DefaultTransactionStatus status) {
      ((TransactionHolder) status.getTransaction()).unit.pendingFailures.clear();
    }

    @Override
    protected void doSetRollbackOnly(DefaultTransactionStatus status) {
      ((TransactionHolder) status.getTransaction()).unit.rollbackOnly = true;
    }

    @Override
    protected void doCleanupAfterCompletion(Object transaction) {
      ((TransactionHolder) transaction).unit.active = false;
      current = null;
    }
  }

  /** 独立事务中的暂存证据与回滚标记，提交后才进入测试的持久结果集合。 */
  private static final class TransactionUnit {
    private boolean active = true;
    private boolean rollbackOnly;
    private final Set<Long> pendingFailures = new HashSet<>();
  }

  /** 持有当前事务资源，让 Spring 能判断 REQUIRED 加入和 REQUIRES_NEW 挂起的差别。 */
  private static final class TransactionHolder implements SmartTransactionObject {
    private TransactionUnit unit;

    private TransactionHolder(TransactionUnit unit) {
      this.unit = unit;
    }

    @Override
    public boolean isRollbackOnly() {
      return unit != null && unit.rollbackOnly;
    }

    @Override
    public void flush() {}
  }

  /** 只模拟事务管理器回调次序；真实提交和回滚另外由数据库环境验证，不能据此声称跨实例语义。 */
  private static PlatformTransactionManager transactions() {
    PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    when(transactions.getTransaction(any()))
        .thenAnswer(invocation -> new SimpleTransactionStatus());
    return transactions;
  }

  /** 此替身仅验证业务事务与失败历史隔离；共享领取、故障和旧租约拒绝由真实双实例专项验证。 */
  private static com.mayday.operations.cluster.DurableTasks durable(
      PlatformTransactionManager manager) {
    var tasks = mock(com.mayday.operations.cluster.DurableTasks.class);
    var payload = new java.util.concurrent.atomic.AtomicReference<String>();
    when(tasks.enqueue(anyString(), anyString(), anyString(), anyInt()))
        .thenAnswer(
            call -> {
              payload.set(call.getArgument(2));
              return 1L;
            });
    when(tasks.claim(anyString(), anyString()))
        .thenAnswer(
            call ->
                new com.mayday.operations.cluster.DurableTasks.Lease(
                    1L, call.getArgument(0), call.getArgument(1), payload.get(), "test-lease", 1));
    var transaction = new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    when(tasks.inspect(anyString(), anyString(), any()))
        .thenAnswer(
            call ->
                transaction.execute(
                    status -> ((java.util.function.Supplier<?>) call.getArgument(2)).get()));
    when(tasks.fenced(any(), any()))
        .thenAnswer(
            call ->
                transaction.execute(
                    status -> ((java.util.function.Supplier<?>) call.getArgument(1)).get()));
    when(tasks.finish(any(), any()))
        .thenAnswer(
            call ->
                transaction.execute(
                    status -> ((java.util.function.Supplier<?>) call.getArgument(1)).get()));
    org.mockito.Mockito.doAnswer(
            call -> {
              transaction.executeWithoutResult(
                  status ->
                      ((java.util.function.Consumer<String>) call.getArgument(3)).accept("FAILED"));
              return null;
            })
        .when(tasks)
        .failed(any(), anyString(), anyBoolean(), any());
    return tasks;
  }
}
