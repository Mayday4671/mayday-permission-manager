package com.mayday.operations.storage;

import com.mayday.operations.repository.FilePayloadRepository;
import com.mayday.operations.repository.StoredFileRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 回收文件永久清理任务：每轮最多 10 个，失败保留清理意图和可读错误供后续重试。 只有不可恢复的回收记录参与，存储删除幂等，因此进程重启或数据库失败不会影响在用附件。 */
@Component
@Slf4j
public class FilePurgeWorker {
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final StoredFileContent content;
  private final TransactionTemplate transactions;

  public FilePurgeWorker(
      StoredFileRepository files,
      FilePayloadRepository payloads,
      StoredFileContent content,
      PlatformTransactionManager transactionManager) {
    this.files = files;
    this.payloads = payloads;
    this.content = content;
    this.transactions = new TransactionTemplate(transactionManager);
  }

  /** 每轮最多处理十个持久化清理意图；先幂等删除正文，失败保留回收记录供重试和排障。 */
  @Scheduled(fixedDelay = 30_000, initialDelay = 15_000)
  public void clean() {
    for (var candidate : files.findTop10ByPurgeRequestedAtIsNotNullOrderByPurgeRequestedAtAsc()) {
      try {
        transactions.executeWithoutResult(
            status -> {
              var file = files.lock(candidate.getId()).orElse(null);
              if (file == null || file.getPurgeRequestedAt() == null || file.getDeletedAt() == null)
                return;
              try {
                if ("MYSQL".equals(file.getStorageProvider())) {
                  payloads.deleteById(file.getId());
                  payloads.flush();
                } else {
                  FileStorage storage = content.storage(file.getStorageProvider());
                  if (file.getThumbnailKey() != null) storage.delete(file.getThumbnailKey());
                  storage.delete(file.getStorageKey());
                }
                files.delete(file);
                files.flush();
              } catch (Exception exception) {
                file.setPurgeError("存储清理失败，将自动重试；请检查部署配置或存储服务");
                files.save(file);
                log.warn("文件永久清理失败，保留回收记录等待重试，文件标识 {}", file.getId());
              }
            });
      } catch (Exception exception) {
        // 数据库故障也不丢弃意图；下轮重新读取待清理记录，不依赖进程内队列。
        log.warn("文件清理事务未提交，文件标识 {}", candidate.getId());
      }
    }
  }
}
