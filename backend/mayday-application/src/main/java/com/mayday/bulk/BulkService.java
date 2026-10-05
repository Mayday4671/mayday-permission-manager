package com.mayday.bulk;

import com.mayday.common.BusinessException;
import com.mayday.operations.cluster.DurableTasks;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.annotation.PreDestroy;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** 批量作业通用调度层：注册资源白名单、原子导入、有限队列、分页写出、本人下载及过期清理。 工作线程每页重新从数据库载入创建人并验证权限，线程结束清空身份；不会继承长期缓存的请求身份。 */
@Service
public class BulkService {
  private static final List<String> ACTIVE = List.of("QUEUED", "RUNNING");
  private static final int MAX_EXPORT_ROWS = 100000;
  private final BulkJobRepository jobs;
  private final UserRepository users;
  private final AccessPolicy access;
  private final BulkIdentity identity;
  private final Map<String, BulkResourceAdapter> adapters;
  private final TransactionTemplate transactions;
  private final JsonMapper json;
  private final Path spool;
  private final DurableTasks durable;
  private final BulkResultStore results;
  private final Map<Long, DurableTasks.Lease> running = new ConcurrentHashMap<>();
  private static final String TASK_TYPE = "BULK_EXPORT";

  /** API 节点可关闭本机工作器，由其他实例领取同一持久队列；不关闭作业控制及下载授权。 */
  @Value("${mayday.bulk.workers-enabled:true}")
  private boolean workersEnabled = true;

  private final ThreadPoolExecutor worker =
      new ThreadPoolExecutor(
          2,
          2,
          0,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(16),
          runnable -> {
            Thread thread = new Thread(runnable, "mayday-bulk-export");
            thread.setDaemon(true);
            return thread;
          },
          new ThreadPoolExecutor.AbortPolicy());

  public BulkService(
      BulkJobRepository jobs,
      UserRepository users,
      AccessPolicy access,
      BulkIdentity identity,
      List<BulkResourceAdapter> adapters,
      PlatformTransactionManager manager,
      JsonMapper json,
      DurableTasks durable,
      BulkResultStore results,
      BulkSpoolCleanup spoolManager) {
    this.jobs = jobs;
    this.users = users;
    this.access = access;
    this.identity = identity;
    this.adapters =
        adapters.stream()
            .collect(
                Collectors.toUnmodifiableMap(BulkResourceAdapter::resource, adapter -> adapter));
    this.transactions = new TransactionTemplate(manager);
    this.json = json;
    this.durable = durable;
    this.results = results;
    this.spool = spoolManager.directory();
  }

  /** 停止本机线程；未提交作业由其他实例在原租约到期后重领，不影响已完成共享正文。 */
  @PreDestroy
  public void stop() {
    worker.shutdownNow();
  }

  /** 模板只有标题，不包含默认密码或示例账号，业务方自行填写显式授权字段。 */
  public String template(String resource) {
    BulkResourceAdapter adapter = adapter(resource);
    adapter.requireImport();
    StringWriter output = new StringWriter();
    try {
      CsvCodec.writeRow(output, adapter.templateHeaders());
    } catch (IOException exception) {
      throw new IllegalStateException(exception);
    }
    return "\ufeff" + output;
  }

  /** 在只作校验的事务中读取组织与授权数据，原文件不保存，密码不进入响应。 */
  public BulkContracts.ImportPreview preview(String resource, byte[] bytes) {
    BulkResourceAdapter adapter = adapter(resource);
    adapter.requireImport();
    return transactions.execute(status -> adapter.preview(CsvCodec.parse(bytes)));
  }

  /** 锁定创建人串行化幂等检查；导入成功标记和账号写入同事务提交，失败不留下半批账号。 */
  public BulkContracts.ImportResult commit(String resource, byte[] bytes, String idempotencyKey) {
    if (idempotencyKey == null || !idempotencyKey.matches("[a-zA-Z0-9-]{16,64}"))
      throw new BusinessException("缺少有效的提交标识，请重新打开导入弹窗");
    BulkResourceAdapter adapter = adapter(resource);
    adapter.requireImport();
    CsvCodec.Document document = CsvCodec.parse(bytes);
    Long ownerId = access.current().getId();
    return transactions.execute(
        status -> {
          users.lockById(ownerId).orElseThrow(() -> new AccessDeniedException("账号不存在"));
          var previous = jobs.findByOwnerIdAndIdempotencyKey(ownerId, idempotencyKey);
          if (previous.isPresent()) {
            BulkJob job = previous.get();
            if (!"IMPORT".equals(job.getKind())
                || !resource.equals(job.getResource())
                || !identity.matchesInput(bytes, job.getInputChecksum()))
              throw new BusinessException("提交标识已用于其他导入，请重新预览");
            return new BulkContracts.ImportResult(job.getId(), job.getProcessedRows());
          }
          int imported = adapter.commit(document);
          BulkJob job = newJob(ownerId, resource);
          job.setKind("IMPORT");
          job.setStatus("SUCCEEDED");
          job.setIdempotencyKey(idempotencyKey);
          job.setInputChecksum(identity.encodeInput(bytes));
          job.setProcessedRows(imported);
          job.setTotalRows(imported);
          jobs.saveAndFlush(job);
          return new BulkContracts.ImportResult(job.getId(), imported);
        });
  }

  /** 每个账号最多两个未完成作业；先持久化作业再排队，启动扫描修复排队前崩溃的窄窗口。 */
  public BulkContracts.JobView export(
      String resource, BulkContracts.ExportFilter filter, String requestKey) {
    String idempotencyKey = requestKey == null ? UUID.randomUUID().toString() : requestKey;
    if (!idempotencyKey.matches("[a-zA-Z0-9-]{16,64}")) throw new BusinessException("导出提交标识无效");
    BulkResourceAdapter adapter = adapter(resource);
    adapter.requireExport();
    if (filter.keyword() != null && filter.keyword().length() > 200
        || filter.departmentId() != null && filter.departmentId() <= 0)
      throw new BusinessException("导出筛选不合法");
    Long ownerId = access.current().getId();
    BulkJob job =
        transactions.execute(
            status -> {
              users.lockById(ownerId).orElseThrow(() -> new AccessDeniedException("账号不存在"));
              var previous = jobs.findByOwnerIdAndIdempotencyKey(ownerId, idempotencyKey);
              if (previous.isPresent()) {
                var found = previous.get();
                if (!"EXPORT".equals(found.getKind())
                    || !resource.equals(found.getResource())
                    || !json.writeValueAsString(filter).equals(found.getQueryJson()))
                  throw new BusinessException("提交标识已用于其他导出");
                return found;
              }
              if (jobs.countByOwnerIdAndKindAndStatusIn(ownerId, "EXPORT", ACTIVE) >= 2)
                throw new BusinessException("已有两个导出任务执行中，请稍后重试");
              BulkJob created = newJob(ownerId, resource);
              created.setQueryJson(json.writeValueAsString(filter));
              created.setIdempotencyKey(idempotencyKey);
              created.setResultKey(UUID.randomUUID().toString());
              return jobs.saveAndFlush(created);
            });
    durable.enqueue(TASK_TYPE, String.valueOf(job.getId()), String.valueOf(job.getId()), 3);
    return view(job.getId());
  }

  /** 列表只查询本人作业，任务 ID 并非下载凭据，超级管理员也没有隐含查看他人导出权限。 */
  public List<BulkContracts.JobView> list() {
    return jobs.findTop20ByOwnerIdOrderByIdDesc(access.current().getId()).stream()
        .map(BulkJob::view)
        .toList();
  }

  /** 查询进度先核实本人归属和过期时间，不能把无权访问误显示为“任务未完成”。 */
  public BulkContracts.JobView view(Long id) {
    return owned(id, false).view();
  }

  /** 下载前重新比对当前授权指纹；仅成功导出可读取，临时文件丢失时必须重新生成。 */
  public FileSystemResource download(Long id) {
    BulkJob job = owned(id, true);
    if (!"EXPORT".equals(job.getKind()) || !"SUCCEEDED".equals(job.getStatus()))
      throw new BusinessException("任务尚未完成");
    Path file = result(job.getResultKey(), false);
    if (!results.restore(job.getId(), file)) throw new BusinessException("导出正文不可用，请重新创建任务");
    return results.resource(file);
  }

  /** 文件名由注册业务标题和服务器作业编号组成，不采用用户上传名称或目录路径。 */
  public String downloadName(Long id) {
    BulkJob job = owned(id, true);
    return adapter(job.getResource()).title() + "-导出-" + job.getId() + ".csv";
  }

  private BulkJob owned(Long id, boolean strict) {
    BulkJob job = jobs.findById(id).orElseThrow(() -> new BusinessException("作业不存在"));
    if (!Objects.equals(job.getOwnerId(), access.current().getId()))
      throw new AccessDeniedException("只能访问自己的批量作业");
    if (job.getExpiresAt().isBefore(LocalDateTime.now()))
      throw new BusinessException("作业已过期，请重新执行");
    if ("EXPORT".equals(job.getKind())) {
      adapter(job.getResource()).requireExport();
      if (strict && !identity.signature().equals(job.getPermissionSignature()))
        throw new AccessDeniedException("当前权限或数据范围已变化，请重新导出");
    }
    return job;
  }

  private BulkJob newJob(Long ownerId, String resource) {
    BulkJob job = new BulkJob();
    job.setOwnerId(ownerId);
    job.setResource(resource);
    job.setPermissionSignature(identity.signature());
    job.setExpiresAt(LocalDateTime.now().plusHours(24));
    return job;
  }

  private BulkResourceAdapter adapter(String resource) {
    BulkResourceAdapter adapter = adapters.get(resource);
    if (adapter == null) throw new BusinessException("该资源不支持批量数据操作");
    return adapter;
  }

  /** 短扫描只提交已持久化作业；每实例最多两个执行线程，重启后的过期租约重新生成单份正文。 */
  @Scheduled(fixedDelayString = "${mayday.bulk.poll-ms:1000}", initialDelay = 3000)
  public synchronized void dispatch() {
    if (!workersEnabled || worker.isShutdown() || running.size() >= 2) return;
    // 修复“业务作业已提交、排队之前崩溃”的窄窗口；稳定业务键保证重复协调不创建第二份队列。
    for (BulkJob job : jobs.findTop100ByKindAndStatusInOrderByIdAsc("EXPORT", ACTIVE)) {
      String key = String.valueOf(job.getId());
      if (durable.state(TASK_TYPE, key) == null) durable.enqueue(TASK_TYPE, key, key, 3);
      else
        durable.synchronizeTerminal(
            TASK_TYPE,
            key,
            terminal ->
                jobs.lock(job.getId())
                    .ifPresent(
                        current -> {
                          if (ACTIVE.contains(current.getStatus())) {
                            current.setStatus(terminal);
                            current.setFailure(
                                "FAILED".equals(terminal) ? "自动恢复重试已达上限，可手动重试" : "已取消");
                          }
                        }));
    }
    while (running.size() < 2) {
      var lease = durable.claim(TASK_TYPE);
      if (lease == null) return;
      running.put(lease.id(), lease);
      try {
        worker.execute(() -> execute(lease));
      } catch (RejectedExecutionException failure) {
        running.remove(lease.id());
        durable.failed(lease, "本机工作队列繁忙，稍后恢复", true);
        return;
      }
    }
  }

  /** 独立心跳不会等待文件或分页工作；取消/失效后不延长租约，旧线程下一次检查会退出。 */
  @Scheduled(fixedDelay = 5000)
  public void renewLeases() {
    for (var lease : running.values()) durable.heartbeat(lease);
  }

  private void execute(DurableTasks.Lease lease) {
    long id = Long.parseLong(lease.payload());
    BulkJob job = jobs.findById(id).orElse(null);
    if (job == null) {
      durable.failed(lease, "业务作业已清理", false);
      running.remove(lease.id());
      return;
    }
    Path temporary = spool.resolve(job.getResultKey() + "-" + lease.token() + ".part");
    try {
      int processed = 0;
      try (BufferedWriter output = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) {
        BulkResourceAdapter adapter = adapter(job.getResource());
        BulkContracts.ExportFilter filter =
            json.readValue(job.getQueryJson(), BulkContracts.ExportFilter.class);
        output.write('\ufeff');
        CsvCodec.writeRow(
            output,
            asOwner(
                job,
                () -> {
                  adapter.requireExport();
                  return adapter.exportHeaders();
                }));
        update(lease, id, "RUNNING", 0, 0);
        for (int page = 1; ; page++) {
          if (Thread.currentThread().isInterrupted() || !durable.heartbeat(lease))
            throw new DurableTasks.LostLease();
          int currentPage = page;
          var batch = asOwner(job, () -> adapter.exportPage(filter, currentPage));
          if (batch.total() > MAX_EXPORT_ROWS || processed + batch.rows().size() > MAX_EXPORT_ROWS)
            throw new BusinessException("单次最多导出 100000 条，请缩小筛选范围");
          for (List<String> row : batch.rows()) CsvCodec.writeRow(output, row);
          processed += batch.rows().size();
          output.flush();
          if (Files.size(temporary) > 32L * 1024 * 1024)
            throw new BusinessException("单份导出最大 32 MB，请缩小筛选范围");
          update(lease, id, "RUNNING", processed, batch.total());
          if (batch.rows().isEmpty() || processed >= batch.total()) break;
        }
      }
      int finalProcessed = processed;
      durable.finish(
          lease,
          () -> {
            asOwner(
                job,
                () -> {
                  adapter(job.getResource()).requireExport();
                  return null;
                });
            results.save(id, temporary);
            var current = jobs.lock(id).orElseThrow(DurableTasks.LostLease::new);
            if ("CANCELLED".equals(current.getStatus())) throw new DurableTasks.LostLease();
            current.setStatus("SUCCEEDED");
            current.setFailure(null);
            current.setProcessedRows(finalProcessed);
            current.setTotalRows(finalProcessed);
            return null;
          });
    } catch (DurableTasks.LostLease failure) {
      // 原令牌失效不写业务状态，尤其不能删除新实例已成功发布的正文或覆盖取消结果。
    } catch (Exception failure) {
      boolean recoverable =
          !(failure instanceof BusinessException || failure instanceof AccessDeniedException);
      String explanation = recoverable ? "导出暂时失败，系统将按重试上限恢复" : failure.getMessage();
      String safeExplanation = explanation == null ? "导出失败" : explanation;
      durable.failed(
          lease,
          safeExplanation,
          recoverable,
          next ->
              jobs.lock(id)
                  .ifPresent(
                      current -> {
                        current.setStatus(next);
                        current.setFailure(safeExplanation);
                      }));
    } finally {
      running.remove(lease.id());
      SecurityContextHolder.clearContext();
      try {
        Files.deleteIfExists(temporary);
      } catch (IOException ignored) {
        /* 只清理本租约文件，不触碰其他工作器输出。 */
      }
    }
  }

  /** 本人取消立即撤销租约；后台线程不再允许发布成功正文，已成功作业不可假装取消。 */
  public BulkContracts.JobView cancel(Long id) {
    BulkJob job = owned(id, false);
    if (!"EXPORT".equals(job.getKind()) || !ACTIVE.contains(job.getStatus()))
      throw new BusinessException("作业当前不能取消");
    if (!durable.cancel(
        TASK_TYPE,
        String.valueOf(id),
        () ->
            jobs.lock(id)
                .ifPresent(
                    current -> {
                      if (!ACTIVE.contains(current.getStatus()))
                        throw new BusinessException("作业状态已变化，请刷新");
                      current.setStatus("CANCELLED");
                      current.setFailure("已取消");
                    }))) throw new BusinessException("作业状态已变化，请刷新");
    return view(id);
  }

  /** 明确重试失败或取消作业；权限已变化必须新建导出，不能复用旧数据范围扩大下载权限。 */
  public BulkContracts.JobView retry(Long id) {
    BulkJob job = owned(id, true);
    if (!"EXPORT".equals(job.getKind())
        || !List.of("FAILED", "CANCELLED").contains(job.getStatus()))
      throw new BusinessException("作业当前不能重试");
    if (!durable.retry(
        TASK_TYPE,
        String.valueOf(id),
        () -> {
          users.lockById(job.getOwnerId()).orElseThrow();
          if (jobs.countByOwnerIdAndKindAndStatusIn(job.getOwnerId(), "EXPORT", ACTIVE) >= 2)
            throw new BusinessException("已有两个导出任务执行中");
          jobs.lock(id)
              .ifPresent(
                  current -> {
                    if (!List.of("FAILED", "CANCELLED").contains(current.getStatus()))
                      throw new BusinessException("作业状态已变化，请刷新");
                    current.setStatus("QUEUED");
                    current.setFailure(null);
                    current.setProcessedRows(0);
                    current.setTotalRows(0);
                  });
        })) throw new BusinessException("任务状态已变化，请刷新");
    return view(id);
  }

  private <T> T asOwner(BulkJob job, Supplier<T> work) {
    return transactions.execute(
        status -> {
          SysUser owner =
              users
                  .findById(job.getOwnerId())
                  .filter(SysUser::isEnabled)
                  .orElseThrow(() -> new AccessDeniedException("任务创建账号已失效"));
          var context = SecurityContextHolder.createEmptyContext();
          context.setAuthentication(
              new UsernamePasswordAuthenticationToken(owner, null, List.of()));
          SecurityContextHolder.setContext(context);
          try {
            if (!job.getPermissionSignature().equals(identity.signature()))
              throw new AccessDeniedException("权限或数据范围已变化，请重新导出");
            return work.get();
          } finally {
            SecurityContextHolder.clearContext();
          }
        });
  }

  private void update(DurableTasks.Lease lease, Long id, String state, int processed, long total) {
    durable.fenced(
        lease,
        () -> {
          transactions.executeWithoutResult(
              status ->
                  jobs.lock(id)
                      .ifPresent(
                          job -> {
                            job.setStatus(state);
                            job.setProcessedRows(processed);
                            job.setTotalRows(total);
                          }));
          return null;
        });
  }

  /** 存储键只由服务端 UUID 生成，文件名解析不能接受路径分隔符或客户端指定路径。 */
  private Path result(String key, boolean temporary) {
    if (key == null || !key.matches("[a-f0-9-]{36}")) throw new BusinessException("导出文件标识异常");
    Path path = spool.resolve(key + (temporary ? ".part" : ".csv")).normalize();
    if (!path.startsWith(spool)) throw new BusinessException("导出路径异常");
    return path;
  }

  private void deleteResult(BulkJob job) {
    if (job.getResultKey() == null) return;
    try {
      Files.deleteIfExists(result(job.getResultKey(), true));
      Files.deleteIfExists(result(job.getResultKey(), false));
    } catch (IOException exception) {
      /* 清理失败保留元数据，下一轮重试；不记录可能包含部署路径的异常正文。 */
    }
  }

  /** 每轮有界清理，导入幂等记录也只保留 24 小时；到期后重复账号仍被业务唯一约束阻止。 */
  @Scheduled(fixedDelayString = "${mayday.bulk.cleanup-interval-ms:60000}")
  public void cleanup() {
    transactions.executeWithoutResult(
        status -> {
          for (BulkJob job : jobs.findTop100ByExpiresAtBefore(LocalDateTime.now())) {
            deleteResult(job);
            if (job.getResultKey() == null
                || !Files.exists(result(job.getResultKey(), false))
                    && !Files.exists(result(job.getResultKey(), true))) jobs.delete(job);
          }
        });
  }
}
