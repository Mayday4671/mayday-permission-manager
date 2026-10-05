package com.mayday.service;

import com.mayday.common.BusinessTime;
import com.mayday.content.NoticeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 数据库保存排期，重启不丢任务。扫描不持事务，每篇独立提交；临时数据库故障保留排期等待下一次重试。 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ContentSchedule {
  private final NoticeRepository notices;
  private final ContentService service;

  /** 每轮最多领取100篇到期内容，每篇调用独立事务重新校验排期；单篇失败保留时间点以供下一轮重试。 */
  @Scheduled(fixedDelayString = "${mayday.content.schedule-delay-ms:5000}")
  public void tick() {
    var now = BusinessTime.now();
    var due =
        notices.findAll(
            (r, q, c) ->
                c.and(
                    c.isNull(r.get("deletedAt")),
                    c.or(
                        c.lessThanOrEqualTo(r.get("scheduledPublishAt"), now),
                        c.and(
                            c.isTrue(r.get("published")),
                            c.lessThanOrEqualTo(r.get("liveOfflineAt"), now)))),
            PageRequest.of(0, 100));
    for (var n : due)
      try {
        service.applyDue(n.getId());
      } catch (RuntimeException error) {
        log.warn("内容排期处理失败，将重试，内容 ID {}，异常类型 {}", n.getId(), error.getClass().getSimpleName());
      }
  }
}
