import com.mayday.bulk.BulkResultStore;
import com.mayday.bulk.BulkSpoolCleanup;
import com.mayday.common.BusinessException;
import com.mayday.operations.cluster.DurableTasks;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 真实 MySQL 的内部租约协议探针，直接使用交付 JAR 的 DurableTasks 类而非复制实现。 只接受本机随机隔离项目；用测试类型和精确主键制造到期条件，不修改日常业务状态。
 * 以两份独立执行器模拟不同进程身份，另用线程竞争检验数据库领取的互斥性。
 */
public final class ClusterPersistenceProbe {
  private static final String TYPE =
      "QA_PROBE_"
          + UUID.randomUUID().toString().replace('-', '_').toUpperCase(java.util.Locale.ROOT);
  private static final String MARKER = UUID.randomUUID().toString().replace("-", "").repeat(2);

  /** 测试入口只显示固定检查结果，连接配置和随机隔离令牌永远不输出。 */
  public static void main(String[] args) throws Exception {
    require(
        System.getenv("CLUSTER_TEST_PROJECT").matches("mayday-check-\\d+-[a-f0-9]{6}"), "不是自有隔离项目");
    String url = System.getenv("DB_URL");
    require(url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/mayday_verify\\?.*"), "不是本机隔离数据库");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("DB_USERNAME"), System.getenv("DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    var manager = new DataSourceTransactionManager(source);
    var first = new DurableTasks(jdbc, manager, 15);
    var second = new DurableTasks(jdbc, manager, 15);
    if (args.length == 1 && "spool".equals(args[0])) {
      checkSpool(jdbc);
      return;
    }
    try {
      String recoveryKey = UUID.randomUUID().toString();
      first.enqueue(TYPE, recoveryKey, "frozen-input", 3);
      var stale = first.claim(TYPE, recoveryKey);
      require(stale != null && stale.attempt() == 1, "首次未正确领取");
      require(second.claim(TYPE, recoveryKey) == null, "有效租约被另一执行器抢占");
      jdbc.update(
          "update sys_durable_task set lease_until=cast(unix_timestamp(current_timestamp(3))*1000"
              + " as unsigned)-1 where id=?",
          stale.id());
      require(!first.heartbeat(stale), "已过期租约被迟到心跳复活");
      var current = second.claim(TYPE, recoveryKey);
      require(
          current != null && current.attempt() == 2 && !current.token().equals(stale.token()),
          "故障重领未替换所有权");
      lost(
          () ->
              first.finish(
                  stale,
                  () -> {
                    jdbc.update("insert into sys_security_rate values(?,1,9999999999999)", MARKER);
                    return null;
                  }));
      require(
          count(jdbc, "select count(*) from sys_security_rate where rate_key=?", MARKER) == 0,
          "旧工作器写入了业务结果");
      first.failed(stale, "旧工作器失败", false);
      require("RUNNING".equals(second.state(TYPE, recoveryKey)), "旧失败覆盖新工作器状态");
      try {
        second.finish(
            current,
            () -> {
              jdbc.update("insert into sys_security_rate values(?,1,9999999999999)", MARKER);
              throw new BusinessException("探针模拟结果事务失败");
            });
        throw new AssertionError("结果事务错误被吞掉");
      } catch (BusinessException expected) {
        /* 必须同时回滚业务标记和队列成功状态。 */
      }
      require(
          count(jdbc, "select count(*) from sys_security_rate where rate_key=?", MARKER) == 0,
          "业务失败未回滚结果");
      require("RUNNING".equals(second.state(TYPE, recoveryKey)), "失败事务提前发布成功");
      second.finish(
          current,
          () -> {
            jdbc.update("insert into sys_security_rate values(?,1,9999999999999)", MARKER);
            return null;
          });
      require("SUCCEEDED".equals(second.state(TYPE, recoveryKey)), "有效工作器未完成");
      require(
          count(jdbc, "select count(*) from sys_security_rate where rate_key=?", MARKER) == 1,
          "业务与成功状态没有共同提交");
      lost(() -> first.complete(stale));
      System.out.println("PASS 过期与取消租约隔离、结果和成功状态原子提交");

      String retryKey = UUID.randomUUID().toString();
      first.enqueue(TYPE, retryKey, "retry-input", 2);
      var one = first.claim(TYPE, retryKey);
      first.failed(one, "可恢复故障", true);
      require("QUEUED".equals(first.state(TYPE, retryKey)), "可恢复故障没有退避重排");
      jdbc.update("update sys_durable_task set next_attempt_at=0 where id=?", one.id());
      var two = second.claim(TYPE, retryKey);
      require(two != null && two.attempt() == 2, "重试次数不正确");
      second.failed(two, "重试达到上限", true);
      require("FAILED".equals(first.state(TYPE, retryKey)), "没有执行重试上限");
      require(first.retry(TYPE, retryKey), "终态未能明确恢复");
      var resumed = second.claim(TYPE, retryKey);
      require(resumed != null && resumed.attempt() == 1, "明确恢复没有重置本轮次数");
      require(first.cancel(TYPE, retryKey, () -> {}), "运行租约未能取消");
      require(!second.heartbeat(resumed), "取消后心跳续期");
      lost(() -> second.complete(resumed));
      require("CANCELLED".equals(first.state(TYPE, retryKey)), "取消被迟到成功覆盖");
      require(first.retry(TYPE, retryKey), "取消后不能恢复");
      first.complete(first.claim(TYPE, retryKey));
      System.out.println("PASS 自动重试上限、明确恢复与运行中取消");

      String raceKey = UUID.randomUUID().toString();
      first.enqueue(TYPE, raceKey, "race-input", 3);
      try (var executor = Executors.newFixedThreadPool(8)) {
        var claims = new ArrayList<Callable<DurableTasks.Lease>>();
        for (int index = 0; index < 20; index++) claims.add(() -> second.claim(TYPE, raceKey));
        var results = executor.invokeAll(claims);
        int received = 0;
        for (var result : results) if (result.get() != null) received++;
        require(received == 1, "并发领取不互斥");
      }
      require(
          count(
                  jdbc,
                  "select count(*) from sys_durable_task where task_type=? and business_key=?",
                  TYPE,
                  raceKey)
              == 1,
          "同业务键产生重复队列");
      System.out.println("PASS 20 次并发数据库领取只有一个有效租约");
    } finally {
      jdbc.update("delete from sys_durable_task where task_type=?", TYPE);
      jdbc.update("delete from sys_security_rate where rate_key=?", MARKER);
    }
  }

  /** 对本轮真实硬杀遗留文件执行交付代码的24小时生命周期回收，并验证有效租约、正在读取、 未过期业务缓存、未知文件、子目录和目录外文件都被保护。老化仅改变本轮文件时间，不等待一天。 */
  private static void checkSpool(JdbcTemplate jdbc) throws Exception {
    String project = System.getenv("CLUSTER_TEST_PROJECT");
    Path spool = Path.of(System.getenv("CLUSTER_TEST_SPOOL")).toAbsolutePath().normalize();
    require(
        spool.getFileName().toString().equals("bulk")
            && spool.getParent().getFileName().toString().equals("a")
            && spool
                .getParent()
                .getParent()
                .getFileName()
                .toString()
                .equals(project.substring("mayday-check-".length()))
            && spool.getParent().getParent().getParent().getFileName().toString().equals("cluster")
            && spool
                .getParent()
                .getParent()
                .getParent()
                .getParent()
                .getFileName()
                .toString()
                .equals(".local")
            && spool.toRealPath().equals(spool),
        "不是本轮本实例受控目录");
    String residueName = System.getenv("CLUSTER_TEST_RESIDUE");
    require(residueName.matches("[a-f0-9-]{36}-[a-f0-9-]{36}\\.part"), "硬杀残留命名异常");
    Path residue = spool.resolve(residueName);
    require(
        Files.isRegularFile(residue, LinkOption.NOFOLLOW_LINKS) && Files.size(residue) > 0,
        "未产生真实硬杀残留");
    String activeKey = System.getenv("CLUSTER_TEST_RESULT_KEY");
    require(activeKey.matches("[a-f0-9-]{36}"), "业务缓存键异常");
    Path activeCache = spool.resolve(activeKey + ".csv");
    require(Files.isRegularFile(activeCache, LinkOption.NOFOLLOW_LINKS), "恢复后的缓存不存在");
    long now =
        jdbc.queryForObject(
            "select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)", Long.class);
    FileTime old = FileTime.fromMillis(now - 25L * 3600 * 1000);
    String lease = UUID.randomUUID().toString(), config = UUID.randomUUID().toString();
    Path activePart = spool.resolve(UUID.randomUUID() + "-" + lease + ".part");
    Path freshPart = spool.resolve(UUID.randomUUID() + "-" + UUID.randomUUID() + ".part");
    Path readingCache = spool.resolve(UUID.randomUUID() + ".csv");
    Path recentCache = spool.resolve(UUID.randomUUID() + ".csv");
    Path abandonedDownload = spool.resolve(UUID.randomUUID() + ".csv-123456789.download");
    Path unknown = spool.resolve("qa-unrecognized-" + config + ".txt");
    Path nested = spool.resolve("qa-nested-" + config),
        nestedFile = nested.resolve(UUID.randomUUID() + ".csv");
    Path outside = spool.getParent().resolve("qa-outside-" + config + ".csv");
    Path link = spool.resolve(UUID.randomUUID() + ".csv");
    var fixtures = new ArrayList<Path>();
    var store = new BulkResultStore(jdbc);
    var cleanup = new BulkSpoolCleanup(jdbc, store, spool.toString());
    cleanup.initialize();
    boolean links = false;
    try {
      jdbc.update(
          "insert into"
              + " sys_durable_task(task_type,business_key,payload,status,attempts,max_attempts,next_attempt_at,lease_owner,lease_token,lease_until,heartbeat_at,created_at,updated_at)"
              + " values('BULK_EXPORT',?,'0','RUNNING',1,3,0,?,?,?, ?,?,?)",
          "qa-cleanup:" + config,
          UUID.randomUUID().toString(),
          lease,
          now + 3600000,
          now,
          now,
          now);
      for (Path file :
          java.util.List.of(
              activePart,
              freshPart,
              readingCache,
              recentCache,
              abandonedDownload,
              unknown,
              outside)) {
        Files.writeString(file, "本轮受控回收样本", StandardOpenOption.CREATE_NEW);
        fixtures.add(file);
        if (!file.equals(freshPart)) Files.setLastModifiedTime(file, old);
      }
      Files.createDirectory(nested);
      fixtures.add(nested);
      Files.writeString(nestedFile, "禁止递归回收", StandardOpenOption.CREATE_NEW);
      fixtures.add(nestedFile);
      Files.setLastModifiedTime(nestedFile, old);
      try {
        Files.createSymbolicLink(link, outside);
        fixtures.add(link);
        links = true;
      } catch (java.nio.file.FileSystemException unsupported) {
        /* Windows没有建链接权限时明确记录跳过链接专项。 */
      }
      Files.setLastModifiedTime(residue, old);
      Files.setLastModifiedTime(activeCache, old);
      store.resource(recentCache); // 创建响应后尚未开启流也刷新访问时间，避免清理与HTTP读取之间的窗口。
      try (var input = store.resource(readingCache).getInputStream()) {
        Files.setLastModifiedTime(readingCache, old);
        cleanup.cleanup();
        require(!Files.exists(residue, LinkOption.NOFOLLOW_LINKS), "过期真实硬杀残留没有回收");
        require(!Files.exists(abandonedDownload, LinkOption.NOFOLLOW_LINKS), "过期无业务下载残留没有回收");
        for (Path file :
            java.util.List.of(
                activePart,
                freshPart,
                readingCache,
                recentCache,
                activeCache,
                unknown,
                nestedFile,
                outside)) require(Files.exists(file, LinkOption.NOFOLLOW_LINKS), "误删活跃或不受控文件");
        require(input.read() != -1, "活跃读取被中断");
        if (links)
          require(
              Files.isSymbolicLink(link) && Files.readString(outside).equals("本轮受控回收样本"),
              "链接被跟随或删除");
      }
      jdbc.update(
          "update sys_durable_task set lease_until=? where task_type='BULK_EXPORT' and"
              + " business_key=?",
          now - 1,
          "qa-cleanup:" + config);
      cleanup.cleanup();
      require(!Files.exists(activePart, LinkOption.NOFOLLOW_LINKS), "失效租约文件没有回收");
      require(!Files.exists(readingCache, LinkOption.NOFOLLOW_LINKS), "关闭读取后的过期孤立缓存没有回收");
      require(Files.exists(activeCache, LinkOption.NOFOLLOW_LINKS), "未过期作业缓存被回收");
      checkBoundedSweep(jdbc, store, spool, old);
      System.out.println(
          "PASS 真实硬杀残留24h回收、有效租约与下载读取保护、禁止越界递归；symbolic-link="
              + (links ? "checked" : "skipped-permission"));
    } finally {
      cleanup.close();
      jdbc.update(
          "delete from sys_durable_task where task_type='BULK_EXPORT' and business_key=?",
          "qa-cleanup:" + config);
      java.util.Collections.reverse(fixtures);
      for (Path fixture : fixtures) Files.deleteIfExists(fixture);
    }
  }

  /** 641个自有目录项检验每轮删除上限和跨轮游标公平性；未知文件再多也不能让尾部缓存永久饥饿。 */
  private static void checkBoundedSweep(
      JdbcTemplate jdbc, BulkResultStore store, Path spool, FileTime old) throws Exception {
    Path directory = Files.createDirectory(spool.resolve("qa-bounds-" + UUID.randomUUID()));
    var expired = new ArrayList<Path>();
    var unknown = new ArrayList<Path>();
    var cleanup = new BulkSpoolCleanup(jdbc, store, directory.toString());
    cleanup.initialize();
    try {
      for (int index = 0; index < 520; index++) {
        Path file = directory.resolve("qa-unknown-" + index + ".txt");
        Files.writeString(file, "未知文件", StandardOpenOption.CREATE_NEW);
        unknown.add(file);
        Files.setLastModifiedTime(file, old);
      }
      for (int index = 0; index < 121; index++) {
        Path file = directory.resolve(UUID.randomUUID() + ".csv");
        Files.writeString(file, "过期缓存", StandardOpenOption.CREATE_NEW);
        expired.add(file);
        Files.setLastModifiedTime(file, old);
      }
      long previous = 121;
      for (int round = 0; round < 10 && previous != 0; round++) {
        cleanup.cleanup();
        long remaining =
            expired.stream().filter(file -> Files.exists(file, LinkOption.NOFOLLOW_LINKS)).count();
        require(previous - remaining <= 100, "单轮删除超过100条有界上限");
        previous = remaining;
      }
      require(previous == 0, "跨轮扫描游标让尾部过期缓存饥饿");
      require(
          unknown.stream().allMatch(file -> Files.exists(file, LinkOption.NOFOLLOW_LINKS)),
          "有界扫描删除了未知文件");
    } finally {
      cleanup.close();
      for (Path file : expired) Files.deleteIfExists(file);
      for (Path file : unknown) Files.deleteIfExists(file);
      Files.deleteIfExists(directory.resolve(".mayday-spool.lock"));
      Files.deleteIfExists(directory);
    }
  }

  /** 所有断言采用固定错误说明，避免 JUnit 式差异输出随机令牌或数据库上下文。 */
  private static void require(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }

  /** 必须由真正生产租约核验抛出 LostLease；回调本身不能伪造此结果。 */
  private static void lost(Runnable work) {
    try {
      work.run();
      throw new AssertionError("旧租约没有被拒绝");
    } catch (DurableTasks.LostLease expected) {
      /* 正常的失效工作器隔离结果。 */
    }
  }

  private static long count(JdbcTemplate jdbc, String query, Object... values) {
    return jdbc.queryForObject(query, Long.class, values);
  }
}
