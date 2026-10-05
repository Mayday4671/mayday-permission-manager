package com.mayday;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.crawler.CrawlArticleImageRepository;
import com.mayday.crawler.CrawlArticleRepository;
import com.mayday.crawler.CrawlArticles;
import com.mayday.crawler.CrawlController;
import com.mayday.crawler.CrawlItemRepository;
import com.mayday.crawler.CrawlRules;
import com.mayday.crawler.CrawlStore;
import com.mayday.crawler.CrawlTask;
import com.mayday.crawler.CrawlTaskRepository;
import com.mayday.crawler.CrawlWorker;
import com.mayday.crawler.PageExtractor;
import com.mayday.crawler.WebFetcher;
import com.mayday.operations.repository.FilePayloadRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 专用临时 MySQL：仅替换外站 HTTP，真实运行持久队列、事务锁、权限、文件存储、迁移。 无专用环境变量时跳过，绝不连接日常数据库；scripts/verify-crawler.mjs
 * 创建并清理隔离容器。
 */
@EnabledIfEnvironmentVariable(
    named = "CRAWLER_TEST_DB_URL",
    matches = "jdbc:mysql://127[.]0[.]0[.]1:.*?/mayday_crawler_test.*")
@SpringBootTest(
    properties = {
      "mayday.crawler.initial-delay-ms=3600000",
      "mayday.admin-password=CrawlerTest_2026!",
      "mayday.seed-demo-data=false"
    })
class CrawlerIntegrationTest {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> System.getenv("CRAWLER_TEST_DB_URL"));
    registry.add("spring.datasource.username", () -> "mayday_test");
    registry.add("spring.datasource.password", () -> System.getenv("CRAWLER_TEST_DB_PASSWORD"));
  }

  @Autowired CrawlStore store;
  @Autowired CrawlWorker worker;
  @Autowired CrawlController controller;
  @Autowired CrawlTaskRepository tasks;
  @Autowired CrawlItemRepository items;
  @Autowired CrawlArticleRepository articles;
  @Autowired CrawlArticleImageRepository articleImages;
  @Autowired CrawlArticles articleStore;
  @Autowired UserRepository users;
  @Autowired RoleRepository roles;
  @Autowired StoredFileRepository files;
  @Autowired FilePayloadRepository payloads;
  @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
  @MockitoBean WebFetcher fetcher;
  SysUser owner;
  SysRole role;
  TransactionTemplate tx;
  final byte[] png =
      Base64.getDecoder()
          .decode(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
  static final String ROOT = "https://fixture.example/list";

  @BeforeEach
  void prepare() throws Exception {
    tx = new TransactionTemplate(transactionManager);
    role = new SysRole();
    role.setCode("crawler_test");
    role.setName("采集测试");
    role.setPermissions(
        new HashSet<>(
            List.of(
                "crawler:view",
                "crawler:create",
                "crawler:update",
                "crawler:run",
                "crawler:stop",
                "crawler:delete",
                "crawler:download",
                "files:create")));
    role = roles.saveAndFlush(role);
    owner = new SysUser();
    owner.setUsername("crawler_test");
    owner.setNickname("采集测试");
    owner.setPasswordHash("unused-test-only");
    owner.getRoles().add(role);
    owner = users.saveAndFlush(owner);
    login(owner);
    when(fetcher.fetch(anyString(), any(), anyBoolean()))
        .thenAnswer(
            call -> {
              String url = call.getArgument(0);
              boolean image = call.getArgument(2);
              if (image) return new WebFetcher.Response(URI.create(url), "image/png", png);
              String html =
                  switch (url) {
                    case ROOT ->
                        "<a class=detail href=/article/1.html>一</a><a class=next"
                            + " href='?page=2'>下一页</a>";
                    case ROOT + "?page=2" ->
                        "<a class=detail href=/article/2.html>二</a><a class=detail"
                            + " href=/article/1.html>重复</a>";
                    case "https://fixture.example/article/1.html" ->
                        "<h1>文章一</h1><article><p>第一段正文</p><img data-src=/a.png></article><a"
                            + " class=next href=/article/1_2.html>下页</a>";
                    case "https://fixture.example/article/1_2.html" ->
                        "<h1>文章一续页</h1><article><p>第二段正文</p><img src=/b.png></article><a class=next"
                            + " href=/article/1.html>循环</a>";
                    case "https://fixture.example/article/2.html" ->
                        "<h1>文章二</h1><article><p>另一篇正文</p><img src=/a.png><img"
                            + " src=/c.png></article>";
                    default -> throw new IllegalArgumentException("未预期的 URL " + url);
                  };
              return new WebFetcher.Response(
                  URI.create(url), "text/html", html.getBytes(StandardCharsets.UTF_8));
            });
  }

  @AfterEach
  void cleanup() {
    tx.executeWithoutResult(
        s -> {
          articleImages.deleteAllInBatch();
          items.deleteAllInBatch();
          articles.deleteAllInBatch();
          tasks.deleteAllInBatch();
          payloads.deleteAllInBatch();
          files.deleteAllInBatch();
        });
    if (owner != null) users.deleteById(owner.getId());
    if (role != null) roles.deleteById(role.getId());
    SecurityContextHolder.clearContext();
  }

  void login(SysUser user) {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, List.of()));
  }

  CrawlRules rules() {
    var p =
        new CrawlRules.PageRule(
            CrawlRules.Mode.NEXT, CrawlRules.Format.HTML, "a.next", "", 1, 1, 10, "", "", "", "");
    return new CrawlRules(
        ROOT,
        true,
        p,
        p,
        "a.detail",
        "article img",
        List.of("data-src", "src"),
        List.of(),
        20,
        50,
        500);
  }

  CrawlTask create() {
    return store.save(null, "分页测试", rules(), null);
  }

  CrawlTask start(CrawlTask t) {
    return store.start(t.getId(), t.getVersion(), false);
  }

  void due(Long id) {
    tx.executeWithoutResult(
        s -> {
          var task = tasks.findById(id).orElseThrow();
          task.setNextFetchAt(BusinessTime.now().minusSeconds(1));
        });
  }

  void drain(Long id) {
    for (int i = 0; i < 40; i++) {
      due(id);
      worker.tick();
      if (Set.of("COMPLETED", "PARTIAL", "PAUSED", "LIMITED")
          .contains(tasks.findById(id).orElseThrow().getStatus())) return;
    }
    fail("队列未在上限内结束");
  }

  @Test
  void listAndDetailPagesPersistImagesAndDeduplicateUrlsAndBytes() {
    var task = start(create());
    drain(task.getId());
    var done = tasks.findById(task.getId()).orElseThrow();
    assertEquals("COMPLETED", done.getStatus());
    assertEquals(5, done.getPageCount());
    assertEquals(1, done.getImageCount());
    assertEquals(3, items.countByTaskIdAndKind(task.getId(), "IMAGE"));
    assertEquals(1, files.count());
    var image =
        items.findByTaskIdAndStatus(task.getId(), "SUCCESS").stream()
            .filter(i -> i.getFileId() != null)
            .findFirst()
            .orElseThrow();
    assertArrayEquals(png, controller.image(task.getId(), image.getId(), true).getBody());
    assertTrue(store.referenced(image.getFileId()));
    var other = create();
    assertThrows(
        BusinessException.class, () -> controller.image(other.getId(), image.getId(), false));
    store.delete(task.getId());
    assertEquals(1, files.count(), "删除配置保留图片");
    assertTrue(store.referenced(image.getFileId()), "文章仍引用文件，不能被文件中心误删");
  }

  @Test
  void stopRejectsLateResultAndResumeReusesPersistedQueue() {
    var task = start(create());
    var stale = store.claim();
    assertNotNull(stale);
    var current = tasks.findById(task.getId()).orElseThrow();
    store.stop(task.getId(), current.getVersion());
    store.finish(
        stale,
        new PageExtractor.Links(
            "", List.of("https://fixture.example/leak.png"), List.of(), List.of()),
        null,
        null);
    assertEquals(0, items.countByTaskIdAndKind(task.getId(), "IMAGE"));
    assertEquals("PAUSED", tasks.findById(task.getId()).orElseThrow().getStatus());
    start(tasks.findById(task.getId()).orElseThrow());
    drain(task.getId());
    assertEquals(1, files.count());
  }

  @Test
  void revokedPermissionDuringFetchPreventsSavingFiles() {
    var task = start(create());
    var work = store.claim();
    tx.executeWithoutResult(
        s -> {
          var r = roles.findById(role.getId()).orElseThrow();
          r.getPermissions().remove("crawler:run");
        });
    store.finish(work, null, png, null);
    assertEquals(0, files.count());
    assertEquals("PAUSED", tasks.findById(task.getId()).orElseThrow().getStatus());
    assertNull(store.claim());
  }

  @Test
  void expiredLeaseAllowsRecoveryButRejectsOldWorkerCommit() {
    var task = start(create());
    var old = store.claim();
    tx.executeWithoutResult(
        s ->
            tasks
                .findById(task.getId())
                .orElseThrow()
                .setLeaseUntil(BusinessTime.now().minusSeconds(1)));
    var recovered = store.claim();
    assertNotNull(recovered);
    assertEquals(old.itemId(), recovered.itemId());
    assertNotEquals(old.lease(), recovered.lease());
    store.finish(old, null, png, null);
    assertEquals(0, files.count());
    store.finish(
        recovered, new PageExtractor.Links("", List.of(), List.of(), List.of()), null, null);
    drain(task.getId());
    assertEquals("COMPLETED", tasks.findById(task.getId()).orElseThrow().getStatus());
  }

  @Test
  void threeFailuresCanBeRetriedWithoutDuplicatingSucceededWork() throws Exception {
    var task = start(create());
    when(fetcher.fetch(eq(ROOT), any(), eq(false))).thenThrow(new BusinessException("网站暂时不可用"));
    drain(task.getId());
    var failed = tasks.findById(task.getId()).orElseThrow();
    assertEquals("PARTIAL", failed.getStatus());
    assertEquals(1, failed.getFailedCount());
    when(fetcher.fetch(eq(ROOT), any(), eq(false)))
        .thenReturn(new WebFetcher.Response(URI.create(ROOT), "text/html", "<html/>".getBytes()));
    store.start(task.getId(), failed.getVersion(), true);
    drain(task.getId());
    assertEquals("COMPLETED", tasks.findById(task.getId()).orElseThrow().getStatus());
    assertEquals(0, tasks.findById(task.getId()).orElseThrow().getFailedCount());
  }

  @Test
  void ownershipAndGrantChangesAreEnforced() {
    var task = create();
    var stranger = new SysUser();
    stranger.setId(-1L);
    stranger.setRoles(Set.of(role));
    login(stranger);
    assertThrows(AccessDeniedException.class, () -> store.accessible(task.getId(), false));
    assertThrows(
        AccessDeniedException.class, () -> store.start(task.getId(), task.getVersion(), false));
    login(owner);
    owner.setRoles(Set.of());
    assertThrows(AccessDeniedException.class, () -> store.accessible(task.getId(), false));
  }

  @Test
  void startingLocksRulesAndRejectsStaleVersion() {
    var task = create();
    var edited = store.save(task.getId(), "新名称", rules(), task.getVersion());
    assertThrows(
        org.springframework.dao.OptimisticLockingFailureException.class,
        () -> store.start(task.getId(), task.getVersion(), false));
    start(edited);
    assertThrows(
        BusinessException.class,
        () ->
            store.save(
                task.getId(),
                "非法修改",
                rules(),
                tasks.findById(task.getId()).orElseThrow().getVersion()));
  }

  @Test
  void articlesMergePagesRetainSharedImagesAndRejectWrongTask() {
    var task = start(create());
    drain(task.getId());
    var cards = articleStore.list(task.getId(), "", 1, 12);
    assertEquals(2, cards.total());
    assertEquals(2, articles.count());
    var first =
        cards.items().stream().filter(a -> a.title().equals("文章一")).findFirst().orElseThrow();
    var second =
        cards.items().stream().filter(a -> a.title().equals("文章二")).findFirst().orElseThrow();
    assertEquals(2, first.pageCount());
    assertEquals(1, first.imageCount());
    assertEquals(1, second.imageCount());
    var detail = articleStore.detail(task.getId(), first.id());
    assertEquals(
        List.of("第一段正文", "第二段正文"), detail.pages().stream().map(CrawlArticles.Part::body).toList());
    assertEquals(
        detail.images().getFirst().fileId(),
        articleStore.detail(task.getId(), second.id()).images().getFirst().fileId(),
        "跨文章共用配图仍保留引用");
    assertEquals(1, articleStore.list(task.getId(), "文章一", 1, 12).total());
    var other = create();
    assertThrows(BusinessException.class, () -> controller.article(other.getId(), first.id()));
    var stranger = new SysUser();
    stranger.setId(-1L);
    stranger.setRoles(Set.of(role));
    login(stranger);
    assertThrows(AccessDeniedException.class, () -> controller.articles(task.getId(), "", 1, 12));
    assertThrows(AccessDeniedException.class, () -> controller.article(task.getId(), first.id()));
    login(owner);
    store.delete(task.getId());
    assertEquals(2, articles.count());
    assertEquals(4, articleImages.count());
    assertEquals(1, files.count());
    assertEquals(2, articleStore.list(null, "", 1, 24).total());
    assertEquals(
        detail.pages(), articleStore.detail(task.getId(), first.id()).pages(), "删除配置不改变正文及分页");
    assertArrayEquals(
        png, controller.image(task.getId(), detail.images().getFirst().id(), false).getBody());
    assertTrue(tasks.findById(task.getId()).orElseThrow().isArchived());
    assertThrows(BusinessException.class, () -> controller.detail(task.getId()));
    assertThrows(BusinessException.class, () -> controller.items(task.getId(), null, null, 1, 10));
    var archived = tasks.findById(task.getId()).orElseThrow();
    assertThrows(
        BusinessException.class,
        () -> store.save(task.getId(), "恢复", rules(), archived.getVersion()));
    assertThrows(
        BusinessException.class, () -> store.start(task.getId(), archived.getVersion(), false));
    assertThrows(
        BusinessException.class, () -> store.start(task.getId(), archived.getVersion(), true));
    assertThrows(BusinessException.class, () -> store.stop(task.getId(), archived.getVersion()));
    assertThrows(BusinessException.class, () -> store.delete(task.getId()));
    var listed = (com.mayday.common.PageResult<?>) controller.list("", null, 1, 100).data();
    assertEquals(1, listed.total(), "配置列表只剩另一条空配置，不包含已归档的配置");
    login(stranger);
    assertEquals(0, articleStore.list(null, "", 1, 24).total());
    assertThrows(AccessDeniedException.class, () -> controller.article(task.getId(), first.id()));
    assertThrows(
        AccessDeniedException.class,
        () -> controller.image(task.getId(), detail.images().getFirst().id(), false));
    login(owner);
  }

  @Test
  void deletingStoppedConfigurationDoesNotLeaveDataWaitingForever() throws Exception {
    var task = start(create());
    due(task.getId());
    worker.tick();
    due(task.getId());
    var work = store.claim();
    assertNotNull(work);
    var parsed =
        PageExtractor.extract(
            fetcher.fetch(work.url(), work.rules(), false),
            work.rules(),
            true,
            work.ordinal(),
            work.root());
    store.finish(work, parsed, null, null);
    assertEquals(1, articleStore.list(task.getId(), "", 1, 24).total());
    assertThrows(BusinessException.class, () -> store.delete(task.getId()), "运行期间不能删除配置");
    var current = tasks.findById(task.getId()).orElseThrow();
    store.stop(task.getId(), current.getVersion());
    store.delete(task.getId());
    var data = articleStore.list(null, "", 1, 24).items().getFirst();
    assertEquals(0, data.pendingImages());
    assertEquals(1, data.failedImages());
    assertEquals(0, items.findByTaskIdAndStatus(task.getId(), "QUEUED").size());
    assertNull(store.claim(), "归档配置不会再次进入执行队列");
  }

  @Test
  void articleRetryIsIdempotentAndPermissionRevocationRejectsText() throws Exception {
    var task = start(create());
    due(task.getId());
    worker.tick();
    due(task.getId());
    var pageWork = store.claim();
    assertNotNull(pageWork);
    var parsed =
        PageExtractor.extract(
            fetcher.fetch(pageWork.url(), pageWork.rules(), false),
            pageWork.rules(),
            true,
            pageWork.ordinal(),
            pageWork.root());
    tx.executeWithoutResult(
        s -> roles.findById(role.getId()).orElseThrow().getPermissions().remove("crawler:run"));
    store.finish(pageWork, parsed, null, null);
    assertEquals(0, articles.count());
    assertEquals("PAUSED", tasks.findById(task.getId()).orElseThrow().getStatus());
    tx.executeWithoutResult(
        s -> roles.findById(role.getId()).orElseThrow().getPermissions().add("crawler:run"));
    start(tasks.findById(task.getId()).orElseThrow());
    drain(task.getId());
    assertEquals(2, articles.count());
    assertEquals(4, articleImages.count(), "同地址共享关联和同内容不同地址分别关联");
  }

  @Test
  void globalCardsFilterOwnershipBeforeCountingAndPagination() {
    var task = start(create());
    drain(task.getId());
    var own = articleStore.list(null, "", 1, 1);
    assertEquals(2, own.total());
    assertEquals(1, own.items().size());
    var card = own.items().getFirst();
    assertEquals(task.getId(), card.taskId());
    assertEquals("COMPLETED", card.taskStatus());
    assertEquals(50, card.imageLimit());
    assertEquals(1, articleStore.list(null, "文章一", 1, 24).total());
    var stranger = new SysUser();
    stranger.setId(-1L);
    stranger.setRoles(Set.of(role));
    login(stranger);
    assertEquals(0, articleStore.list(null, "", 1, 24).total(), "不能从总数泄露其他人的文章");
    assertEquals(0, articleStore.list(task.getId(), "", 1, 24).total(), "服务内部同样过滤所有权");
    role.getPermissions().add("crawler:all");
    assertEquals(2, articleStore.list(null, "", 1, 24).total());
    role.getPermissions().remove("crawler:view");
    assertThrows(AccessDeniedException.class, () -> controller.articleCards("", 1, 24));
    login(owner);
  }
}
