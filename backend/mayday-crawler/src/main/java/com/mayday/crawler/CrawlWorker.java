package com.mayday.crawler;

import com.mayday.common.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 一次仅处理一条持久队列，页面/图片均遵循间隔；HTTP 不占据数据库事务或行锁。 */
@Component
@RequiredArgsConstructor
public class CrawlWorker {
  private final CrawlStore store;
  private final WebFetcher fetcher;
  private final com.mayday.common.ModuleSwitches modules;

  @Scheduled(
      scheduler = "crawlerScheduler",
      fixedDelayString = "${mayday.crawler.tick-ms:1000}",
      initialDelayString = "${mayday.crawler.initial-delay-ms:5000}")
  public void tick() {
    if (!modules.isEnabled("crawler")) return;
    var work = store.claim();
    if (work == null) return;
    try {
      boolean image = work.kind().equals("IMAGE");
      var response = fetcher.fetch(work.url(), work.rules(), image);
      if (image) {
        ImageBytes.type(response.body());
        store.finish(work, null, response.body(), null);
      } else
        store.finish(
            work,
            PageExtractor.extract(
                response, work.rules(), work.kind().equals("DETAIL"), work.ordinal(), work.root()),
            null,
            null);
    } catch (Exception e) {
      String message =
          e instanceof BusinessException ? e.getMessage() : "网络请求或页面解析失败，请检查地址、规则或稍后重试";
      store.finish(work, null, null, message.length() > 300 ? message.substring(0, 300) : message);
    }
  }
}
