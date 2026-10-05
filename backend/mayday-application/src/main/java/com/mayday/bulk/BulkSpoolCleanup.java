package com.mayday.bulk;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.DirectoryIteratorException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Iterator;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** 只回收本实例受控spool中的过期临时文件与无有效作业缓存。硬杀残留带原租约编号， 扫描不递归、不跟随符号链接，且有扫描/删除上限；数据库不可用时保留文件而非误删活跃输出。 */
@Service
public class BulkSpoolCleanup {
  private static final String UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  private static final Pattern PART = Pattern.compile("(" + UUID + ")-(" + UUID + ")\\.part");
  private static final Pattern DOWNLOAD =
      Pattern.compile("(" + UUID + ")\\.csv-[0-9]{1,30}\\.download");
  private static final Pattern CACHE = Pattern.compile("(" + UUID + ")\\.(?:csv|part)");
  private final JdbcTemplate jdbc;
  private final BulkResultStore results;
  private final Path spool;
  private DirectoryStream<Path> scan;
  private Iterator<Path> cursor;
  private FileChannel lockChannel;
  private FileLock instanceLock;

  /** 配置与生成/下载目录使用同一键，实例应各自配置spool；不会扫描用户上传目录或任意外部路径。 */
  public BulkSpoolCleanup(
      JdbcTemplate jdbc,
      BulkResultStore results,
      @Value("${mayday.bulk.spool-directory:${java.io.tmpdir}/mayday-bulk/${server.port:8080}}")
          String directory) {
    this.jdbc = jdbc;
    this.results = results;
    spool = Path.of(directory).toAbsolutePath().normalize();
  }

  /** 整个进程生命周期独占缓存目录。两个IP即使端口相同也不能误用一个spool；启动即拒绝第二实例， 不等并发下载损坏才报错。锁文件不删除，避免删除后另一进程锁住新文件产生双重所有者。 */
  @PostConstruct
  public synchronized void initialize() {
    if (instanceLock != null && instanceLock.isValid()) return;
    try {
      Files.createDirectories(spool);
      if (!safeRoot()) throw new IOException("目录不满足受控路径要求");
      lockChannel =
          FileChannel.open(
              spool.resolve(".mayday-spool.lock"),
              StandardOpenOption.CREATE,
              StandardOpenOption.WRITE,
              LinkOption.NOFOLLOW_LINKS);
      instanceLock = lockChannel.tryLock();
      if (instanceLock == null) throw new IOException("缓存目录已经被其他实例占用");
    } catch (IOException | OverlappingFileLockException failure) {
      close();
      throw new IllegalStateException(
          "批量作业缓存目录不可安全独占，请为每个实例配置独立 mayday.bulk.spool-directory", failure);
    }
  }

  /** 生成器与清理器共用唯一规范化路径，不各自推导随机目录。 */
  public Path directory() {
    return spool;
  }

  /** 每轮至多检查500个直接子项、删除100个24小时前文件；未来时间及未知命名均保留。 */
  @Scheduled(fixedDelayString = "${mayday.bulk.spool-cleanup-ms:60000}", initialDelay = 5000)
  public synchronized void cleanup() {
    if (!safeRoot()) {
      closeScan();
      return;
    }
    long cutoff =
        jdbc.queryForObject(
            "select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)-86400000",
            Long.class);
    int scanned = 0, deleted = 0;
    try {
      // 保留单个目录迭代游标到下一轮，不把整个目录装入内存；大量活跃文件也不会让尾部旧文件永远饥饿。
      if (scan == null) {
        scan = Files.newDirectoryStream(spool);
        cursor = scan.iterator();
      }
      while (scanned < 500 && deleted < 100) {
        if (!cursor.hasNext()) {
          closeScan();
          break;
        }
        Path child = cursor.next();
        scanned++;
        if (!safeRoot() || !child.normalize().getParent().equals(spool)) {
          closeScan();
          return;
        }
        try {
          var attributes =
              Files.readAttributes(child, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
          if (!attributes.isRegularFile()
              || attributes.isSymbolicLink()
              || attributes.lastModifiedTime().toMillis() >= cutoff) continue;
          String name = child.getFileName().toString();
          var part = PART.matcher(name);
          var download = DOWNLOAD.matcher(name);
          var cache = CACHE.matcher(name);
          boolean eligible;
          if (part.matches()) {
            eligible =
                jdbc.queryForObject(
                        "select count(*) from sys_durable_task where task_type='BULK_EXPORT' and"
                            + " lease_token=? and status='RUNNING' and"
                            + " lease_until>cast(unix_timestamp(current_timestamp(3))*1000 as"
                            + " unsigned)",
                        Long.class,
                        part.group(2))
                    == 0;
          } else if (download.matches()) {
            // 下载缓存没有独立租约；仍存在未过期作业时保留它，防止回收长时间正在重建的下载文件。
            eligible = inactive(download.group(1));
          } else if (cache.matches()) eligible = inactive(cache.group(1));
          else continue;
          if (eligible
              && safeRoot()
              && results.deleteExpiredCache(child, cutoff, attributes.fileKey())) deleted++;
        } catch (IOException vanished) {
          /* 子项由自己的工作器/下载线程移走时继续本轮，不记录部署路径。 */
        }
      }
    } catch (IOException | DirectoryIteratorException unavailable) {
      closeScan();
    }
  }

  /** 停机或目录替换时关闭唯一扫描游标，释放文件系统句柄；下轮从当前安全目录重新开始。 */
  @PreDestroy
  public synchronized void close() {
    closeScan();
    if (instanceLock != null)
      try {
        instanceLock.release();
      } catch (IOException ignored) {
        /* 操作系统在进程退出时也释放该锁。 */
      }
    if (lockChannel != null)
      try {
        lockChannel.close();
      } catch (IOException ignored) {
        /* 仅关闭本实例句柄。 */
      }
    instanceLock = null;
    lockChannel = null;
  }

  private void closeScan() {
    if (scan != null)
      try {
        scan.close();
      } catch (IOException ignored) {
        /* 只释放本实例句柄。 */
      }
    scan = null;
    cursor = null;
  }

  private boolean inactive(String key) {
    return jdbc.queryForObject(
            "select count(*) from sys_bulk_job where result_key=? and"
                + " expires_at>current_timestamp(6)",
            Long.class,
            key)
        == 0;
  }

  /** 根目录也不得是链接、重解析目录或被替换到另一位置；不存在目录时等待生成器初始化。 */
  private boolean safeRoot() {
    try {
      return !Files.isSymbolicLink(spool)
          && Files.isDirectory(spool, LinkOption.NOFOLLOW_LINKS)
          && spool.toRealPath().equals(spool);
    } catch (IOException unavailable) {
      return false;
    }
  }
}
