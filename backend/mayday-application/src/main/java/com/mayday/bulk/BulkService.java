package com.mayday.bulk;

import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
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
      @Value("${mayday.bulk.spool-directory:${java.io.tmpdir}/mayday-bulk}") String directory) {
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
    this.spool = Path.of(directory).toAbsolutePath().normalize();
  }

  /** 临时导出文件不承诺跨容器保留；单实例重启明确中断任务，用户可重新创建作业。 */
  @PostConstruct
  public void initialize() {
    try {
      Files.createDirectories(spool);
    } catch (IOException exception) {
      throw new IllegalStateException("批量作业临时目录不可写", exception);
    }
    transactions.executeWithoutResult(
        status -> {
          for (BulkJob job : jobs.findByKindAndStatusIn("EXPORT", ACTIVE)) {
            job.setStatus("FAILED");
            job.setFailure("服务已重启，请重新创建导出任务");
            deleteResult(job);
          }
        });
    cleanup();
  }

  /** 停止接受新导出并中断执行；持久化任务在下次单实例启动时明确标记失败。 */
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

  /** 每个账号最多两个未完成作业，全局队列也有上限；拒绝时留下可读失败状态而非失联任务。 */
  public BulkContracts.JobView export(String resource, BulkContracts.ExportFilter filter) {
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
              if (jobs.countByOwnerIdAndKindAndStatusIn(ownerId, "EXPORT", ACTIVE) >= 2)
                throw new BusinessException("已有两个导出任务执行中，请稍后重试");
              BulkJob created = newJob(ownerId, resource);
              created.setQueryJson(json.writeValueAsString(filter));
              created.setResultKey(UUID.randomUUID().toString());
              return jobs.saveAndFlush(created);
            });
    try {
      worker.execute(() -> execute(job.getId()));
    } catch (RejectedExecutionException exception) {
      fail(job.getId(), "导出队列已满，请稍后重试");
    }
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
    if (!Files.isRegularFile(file)) throw new BusinessException("临时导出文件已清理，请重新创建任务");
    return new FileSystemResource(file);
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

  private void execute(Long id) {
    BulkJob job = jobs.findById(id).orElse(null);
    if (job == null) return;
    Path temporary = result(job.getResultKey(), true);
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
        update(id, "RUNNING", 0, 0);
        for (int page = 1; ; page++) {
          if (Thread.currentThread().isInterrupted()) throw new BusinessException("导出已中断，请重试");
          int currentPage = page;
          BulkResourceAdapter.ExportPage batch =
              asOwner(job, () -> adapter.exportPage(filter, currentPage));
          if (batch.total() > MAX_EXPORT_ROWS || processed + batch.rows().size() > MAX_EXPORT_ROWS)
            throw new BusinessException("单次最多导出 100000 条，请缩小筛选范围");
          for (List<String> row : batch.rows()) CsvCodec.writeRow(output, row);
          processed += batch.rows().size();
          update(id, "RUNNING", processed, batch.total());
          if (batch.rows().isEmpty() || processed >= batch.total()) break;
        }
        output.flush();
      }
      // 同文件系统先完成正文再替换正式文件，状态成功只在文件可读后发布。
      Files.move(temporary, result(job.getResultKey(), false), StandardCopyOption.REPLACE_EXISTING);
      update(id, "SUCCEEDED", processed, processed);
    } catch (Exception exception) {
      String failure =
          exception instanceof BusinessException || exception instanceof AccessDeniedException
              ? exception.getMessage()
              : "导出失败，请稍后重试";
      fail(id, failure);
      deleteResult(job);
    } finally {
      SecurityContextHolder.clearContext();
    }
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

  private void update(Long id, String state, int processed, long total) {
    transactions.executeWithoutResult(
        status ->
            jobs.findById(id)
                .ifPresent(
                    job -> {
                      job.setStatus(state);
                      job.setProcessedRows(processed);
                      job.setTotalRows(total);
                    }));
  }

  private void fail(Long id, String reason) {
    transactions.executeWithoutResult(
        status ->
            jobs.findById(id)
                .ifPresent(
                    job -> {
                      job.setStatus("FAILED");
                      job.setFailure(
                          reason == null
                              ? "导出失败"
                              : reason.substring(0, Math.min(reason.length(), 500)));
                    }));
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
