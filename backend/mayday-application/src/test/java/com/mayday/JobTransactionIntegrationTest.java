package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.operations.model.ScheduledJob;
import com.mayday.operations.repository.JobExecutionRepository;
import com.mayday.operations.repository.ScheduledJobRepository;
import com.mayday.operations.service.JobHandler;
import com.mayday.operations.service.JobRunner;
import com.mayday.operations.service.JobSchedule;
import java.time.LocalDateTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 复用 verify-crawler 创建的回环专用库，真实验证调度回滚、历史提交、下次时间与领取行锁。 */
@EnabledIfEnvironmentVariable(
    named = "CRAWLER_TEST_DB_URL",
    matches = "jdbc:mysql://127[.]0[.]0[.]1:[0-9]+/mayday_crawler_test(?:[?].*)?")
@SpringBootTest(
    properties = {
      "mayday.crawler.initial-delay-ms=3600000",
      "mayday.seed-demo-data=false",
      "mayday.admin-password=CrawlerTest_2026!",
      "mayday.modules.enabled.notifications=false"
    })
@Import(JobTransactionIntegrationTest.Handlers.class)
class JobTransactionIntegrationTest {
  /** 仅在此集成上下文注册故障注入处理器。 */
  @TestConfiguration
  static class Handlers {
    @Bean
    ProbeHandler auditHandler() {
      return new ProbeHandler();
    }
  }

  /** 执行可控的数据库写入或等待，验证外层真实事务与领取锁。 */
  static class ProbeHandler implements JobHandler {
    Supplier<String> action;
    final AtomicInteger calls = new AtomicInteger();

    @Override
    public String key() {
      return "AUDIT_TRANSACTION_PROBE";
    }

    @Override
    public String label() {
      return "事务回归测试";
    }

    @Override
    public String execute() {
      calls.incrementAndGet();
      return action.get();
    }
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", () -> System.getenv("CRAWLER_TEST_DB_URL"));
    r.add("spring.datasource.username", () -> "mayday_test");
    r.add("spring.datasource.password", () -> System.getenv("CRAWLER_TEST_DB_PASSWORD"));
  }

  @Autowired JobRunner runner;
  @Autowired ScheduledJobRepository jobs;
  @Autowired JobExecutionRepository executions;
  @Autowired JdbcTemplate jdbc;
  @Autowired ProbeHandler handler;
  @Autowired PlatformTransactionManager transactions;
  @MockitoBean JobSchedule schedule;
  ScheduledJob job;

  @BeforeEach
  void prepare() {
    jdbc.execute("CREATE TABLE IF NOT EXISTS audit_job_rollback_probe (id INT PRIMARY KEY)");
    handler.calls.set(0);
    handler.action = () -> "已完成";
    job = new ScheduledJob();
    job.setName("transaction regression");
    job.setHandler(handler.key());
    job.setCron("0 0 * * * *");
    job.setEnabled(true);
    job.setNextRunAt(LocalDateTime.now().minusMinutes(1));
    job = jobs.saveAndFlush(job);
  }

  @AfterEach
  void cleanup() {
    jdbc.update("DELETE FROM ops_job_execution WHERE job_id = ?", job.getId());
    jobs.deleteById(job.getId());
    jdbc.execute("DROP TABLE audit_job_rollback_probe");
  }

  @Test
  void failedHandlerRollsBackButHistoryAndNextScheduleSurviveOuterRollback() {
    handler.action =
        () -> {
          jdbc.update("INSERT INTO audit_job_rollback_probe VALUES (1)");
          throw new IllegalStateException("private SQL/password detail");
        };
    new TransactionTemplate(transactions)
        .executeWithoutResult(
            status -> {
              var result = runner.run(job.getId(), false);
              assertEquals("FAILED", result.getStatus());
              assertFalse(result.getResult().contains("password"));
              status.setRollbackOnly();
            });
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM ops_job_execution WHERE job_id = ? AND status = 'FAILED'",
            Integer.class,
            job.getId()));
    assertEquals(
        0, jdbc.queryForObject("SELECT COUNT(*) FROM audit_job_rollback_probe", Integer.class));
    assertTrue(
        jobs.findById(job.getId()).orElseThrow().getNextRunAt().isAfter(LocalDateTime.now()));
    assertNull(runner.run(job.getId(), false));
    assertEquals(1, handler.calls.get());
  }

  @Test
  void concurrentPollersExecuteTheDueScheduleOnlyOnce() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    handler.action =
        () -> {
          entered.countDown();
          try {
            assertTrue(release.await(10, TimeUnit.SECONDS));
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
          }
          return "已完成";
        };
    try (var pool = Executors.newFixedThreadPool(2)) {
      var first = pool.submit(() -> runner.run(job.getId(), false));
      assertTrue(entered.await(10, TimeUnit.SECONDS));
      var secondStarted = new CountDownLatch(1);
      var second =
          pool.submit(
              () -> {
                secondStarted.countDown();
                return runner.run(job.getId(), false);
              });
      assertTrue(secondStarted.await(10, TimeUnit.SECONDS));
      assertThrows(TimeoutException.class, () -> second.get(200, TimeUnit.MILLISECONDS));
      release.countDown();
      assertEquals("SUCCESS", first.get(15, TimeUnit.SECONDS).getStatus());
      assertNull(second.get(15, TimeUnit.SECONDS));
      assertEquals(1, handler.calls.get());
    } finally {
      release.countDown();
    }
  }
}
