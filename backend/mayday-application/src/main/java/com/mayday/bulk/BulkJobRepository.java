package com.mayday.bulk;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 幂等键按账号隔离；运行限额与过期清理由服务端执行，浏览器不能指定任务归属。 */
public interface BulkJobRepository extends JpaRepository<BulkJob, Long> {
  /** 同一个账号和提交标识仅有一份成功回执；事务内账号锁与唯一约束共同防重复。 */
  Optional<BulkJob> findByOwnerIdAndIdempotencyKey(Long ownerId, String idempotencyKey);

  /** 运行限额只统计本人未结束导出，不把导入回执混入导出队列配额。 */
  long countByOwnerIdAndKindAndStatusIn(Long ownerId, String kind, Collection<String> statuses);

  /** 持久队列协调只扫描有界未完成导出，不重放已提交导入。 */
  List<BulkJob> findTop100ByKindAndStatusInOrderByIdAsc(String kind, Collection<String> statuses);

  /** 作业取消、重试与完成按同一业务行串行更新，不能让旧线程覆盖终态。 */
  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select job from BulkJob job where job.id=:id")
  Optional<BulkJob> lock(@org.springframework.data.repository.query.Param("id") Long id);

  /** 每轮最多清理一百条过期作业，避免文件清理持有无界数据库事务。 */
  List<BulkJob> findTop100ByExpiresAtBefore(LocalDateTime now);

  /** 最近二十条固定由服务器传入本人 ID，不提供任意用户作业浏览接口。 */
  List<BulkJob> findTop20ByOwnerIdOrderByIdDesc(Long ownerId);
}
