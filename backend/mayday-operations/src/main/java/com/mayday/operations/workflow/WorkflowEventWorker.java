package com.mayday.operations.workflow;

import com.mayday.operations.repository.BusinessEventRepository;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 每条消息独立事务，单次失败不阻塞其他人的待办通知；重启后按数据库记录继续投递。 */
@Component
@RequiredArgsConstructor
public class WorkflowEventWorker {
  private final BusinessEventRepository events;
  private final WorkflowEvents delivery;

  @Scheduled(fixedDelay = 3000, initialDelay = 5000)
  public void run() {
    for (Long id : events.due(LocalDateTime.now(), PageRequest.of(0, 100)))
      try {
        delivery.deliver(id);
      } catch (Exception error) {
        delivery.failed(id);
      }
  }
}
