package com.mayday.bulk;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 导出成功正文共享到 MySQL，并与作业成功标记一起提交。各实例的 spool 只保存自己正在生成的临时文件和下载缓存， 切换节点或重启不依赖原实例磁盘；流式写入和读取避免把整份 CSV
 * 加载为应用 byte[]。
 */
@Service
public class BulkResultStore {
  private final JdbcTemplate jdbc;
  private final Object[] cacheLocks = new Object[64];
  private final int[] readers = new int[64];

  public BulkResultStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    java.util.Arrays.setAll(cacheLocks, index -> new Object());
  }

  /** 调用方必须已经持有有效队列租约并处于结果事务；一份作业只发布一份成功正文。 */
  public void save(long jobId, Path source) {
    try (InputStream input = Files.newInputStream(source)) {
      long size = Files.size(source);
      if (size > 32L * 1024 * 1024)
        throw new com.mayday.common.BusinessException("单份导出最大 32 MB，请缩小筛选范围");
      jdbc.update(
          connection -> {
            var statement =
                connection.prepareStatement(
                    "insert into sys_bulk_result(job_id,content,created_at)"
                        + " values(?,?,cast(unix_timestamp(current_timestamp(3))*1000 as unsigned))"
                        + " on duplicate key update"
                        + " content=values(content),created_at=values(created_at)");
            statement.setLong(1, jobId);
            statement.setBinaryStream(2, input, size);
            return statement;
          });
    } catch (IOException failure) {
      throw new IllegalStateException("导出正文提交失败", failure);
    }
  }

  /** 已鉴权的下载在当前实例重建缓存；客户端永远拿不到物理路径或共享正文查询接口。 */
  public boolean restore(long jobId, Path target) {
    // 固定条带锁没有按作业增长的内存表；等待者锁内复查，避免Windows覆盖正在被读取的完整文件。
    synchronized (cacheLocks[stripe(target)]) {
      if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS))
          throw new IllegalStateException("导出缓存类型异常");
        return true;
      }
      return restoreMissing(jobId, target);
    }
  }

  /** 下载资源创建时刷新访问时间，读取期间持有有限条带的读计数。即使作业在读取中到期或被回收， 本实例清理器也不能删除正在读取的缓存；关闭响应流后才解除保护，不建立无限增长的文件锁表。 */
  public FileSystemResource resource(Path target) {
    int index = stripe(target);
    synchronized (cacheLocks[index]) {
      try {
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS))
          throw new IllegalStateException("导出缓存类型异常");
        long now =
            jdbc.queryForObject(
                "select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)", Long.class);
        Files.setLastModifiedTime(target, FileTime.fromMillis(now));
      } catch (IOException failure) {
        throw new IllegalStateException("导出缓存访问失败", failure);
      }
    }
    return new FileSystemResource(target) {
      @Override
      public InputStream getInputStream() throws IOException {
        synchronized (cacheLocks[index]) {
          InputStream input = Files.newInputStream(target, LinkOption.NOFOLLOW_LINKS);
          readers[index]++;
          return new FilterInputStream(input) {
            private boolean closed;

            @Override
            public void close() throws IOException {
              synchronized (cacheLocks[index]) {
                if (closed) return;
                closed = true;
                try {
                  super.close();
                } finally {
                  readers[index]--;
                }
              }
            }
          };
        }
      }
    };
  }

  /** 清理器在同一条带锁下复核文件身份、过期时间与活跃读取；未知类型及被替换文件一律保留。 */
  public boolean deleteExpiredCache(Path target, long cutoff, Object expectedFileKey)
      throws IOException {
    int index = stripe(target);
    synchronized (cacheLocks[index]) {
      if (readers[index] != 0) return false;
      var current =
          Files.readAttributes(target, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
      if (!current.isRegularFile()
          || current.isSymbolicLink()
          || !java.util.Objects.equals(current.fileKey(), expectedFileKey)
          || current.lastModifiedTime().toMillis() >= cutoff) return false;
      return Files.deleteIfExists(target);
    }
  }

  private int stripe(Path path) {
    return Math.floorMod(path.toAbsolutePath().normalize().hashCode(), cacheLocks.length);
  }

  /** 只在作业缓存锁内写缺失结果；先写完整临时文件，再发布不可变缓存供并发下载读取。 */
  private boolean restoreMissing(long jobId, Path target) {
    return jdbc.query(
        "select content from sys_bulk_result where job_id=?",
        result -> {
          if (!result.next()) return false;
          Path temporary = null;
          try {
            // 完整写入唯一临时文件后才发布目标，避免另一个下载请求把半写缓存误认为完整文件。
            temporary =
                Files.createTempFile(target.getParent(), target.getFileName() + "-", ".download");
            try (InputStream input = result.getBinaryStream(1);
                var output = Files.newOutputStream(temporary)) {
              input.transferTo(output);
            }
            try {
              Files.move(
                  temporary,
                  target,
                  StandardCopyOption.ATOMIC_MOVE,
                  StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
              // 同目录完整文件重命名，不退回到直接写入公开下载目标。
              Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
            return true;
          } catch (IOException failure) {
            throw new IllegalStateException("导出下载缓存创建失败", failure);
          } finally {
            if (temporary != null)
              try {
                Files.deleteIfExists(temporary);
              } catch (IOException ignored) {
                /* 仅清理本次下载创建的临时文件。 */
              }
          }
        },
        jobId);
  }
}
