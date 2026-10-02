package com.mayday.operations.workflow;

import com.mayday.common.ModuleSwitches;
import com.mayday.operations.repository.FlowTaskRepository;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每轮限量处理到期任务，每项独立事务；关闭审批模块后停止，重启不丢失待提醒状态。 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WorkflowReminderWorker {
  private final ModuleSwitches modules;
  private final FlowTaskRepository tasks;
  private final WorkflowReminders reminders;

  /** 每轮只取前一百条到期任务，逐项重新行锁校验；单项失败下轮重试，不阻断其他任务。 */
  @Scheduled(fixedDelay = 30_000L, initialDelay = 20_000L)
  public void run() {
    if (!modules.isEnabled("approvals")) return;
    for (Long taskId : tasks.due(LocalDateTime.now(), PageRequest.of(0, 100))) {
      try {
        reminders.timeout(taskId);
      } catch (RuntimeException error) {
        // 不记录表单正文和数据库异常详情；单项失败下轮重试，不阻塞其他申请。
        log.warn("审批超时提醒暂未完成，任务编号 {}", taskId);
      }
    }
  }
}
