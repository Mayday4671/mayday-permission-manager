package com.mayday.crawler;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.mayday.common.ModuleSwitches;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 关闭采集后连领取队列和网络请求都不能发生；不是下载之后再丢弃结果。 */
class CrawlWorkerSwitchTest {
  @Test
  void disabledWorkerDoesNotClaimOrFetch() {
    CrawlStore store = mock(CrawlStore.class);
    WebFetcher fetcher = mock(WebFetcher.class);
    ModuleSwitches modules = new ModuleSwitches();
    modules.setEnabled(Map.of("crawler", false));
    new CrawlWorker(store, fetcher, modules).tick();
    verifyNoInteractions(store, fetcher);
  }

  @Test
  void enabledWorkerStillClaimsDurableQueue() {
    CrawlStore store = mock(CrawlStore.class);
    WebFetcher fetcher = mock(WebFetcher.class);
    new CrawlWorker(store, fetcher, new ModuleSwitches()).tick();
    verify(store).claim();
    verifyNoInteractions(fetcher);
  }
}
