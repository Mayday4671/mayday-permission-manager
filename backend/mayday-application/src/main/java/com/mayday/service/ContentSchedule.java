package com.mayday.service;

import com.mayday.common.util.BusinessTime;
import com.mayday.content.mapper.NoticeMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 数据库保存排期，重启不丢任务。扫描不持事务，每篇独立提交；临时数据库故障保留排期等待下一次重试。 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ContentSchedule {
  private final NoticeMapper notices;
  private final ContentService service;

  /** 每轮最多领取100篇到期内容，每篇调用独立事务重新校验排期；单篇失败保留时间点以供下一轮重试。 */
  @Scheduled(fixedDelayString = "${mayday.content.schedule-delay-ms:5000}")
  public void tick() {
    var now = BusinessTime.now();
    var due =
        notices.selectListByQuery(
            QueryWrapper.create()
                .where(
                    new QueryColumn("deleted_at")
                        .isNull()
                        .and(
                            new QueryColumn("scheduled_publish_at")
                                .le(now)
                                .or(
                                    new QueryColumn("published")
                                        .eq(true)
                                        .and(new QueryColumn("live_offline_at").le(now)))))
                .orderBy("id asc")
                .limit(100));
    for (var n : due) {
      try {
        service.applyDue(n.getId());
      } catch (RuntimeException error) {
        log.warn("内容排期处理失败，将重试，内容 ID {}，异常类型 {}", n.getId(), error.getClass().getSimpleName());
      }
    }
  }
}
