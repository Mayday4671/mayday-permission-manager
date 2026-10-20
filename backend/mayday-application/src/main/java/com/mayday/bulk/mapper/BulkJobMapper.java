package com.mayday.bulk.mapper;

import com.mayday.bulk.BulkJob;
import com.mayday.common.persistence.EntityMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 幂等键按账号隔离；运行限额与过期清理由服务端执行，浏览器不能指定任务归属。 */
@Mapper
public interface BulkJobMapper extends EntityMapper<BulkJob> {
  /** 同一个账号和提交标识仅有一份成功回执；事务内账号锁与唯一约束共同防重复。 */
  default Optional<BulkJob> findByOwnerIdAndIdempotencyKey(Long ownerId, String idempotencyKey) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("owner_id").eq(ownerId))
                .and(new QueryColumn("idempotency_key").eq(idempotencyKey))));
  }

  /** 运行限额只统计本人未结束导出，不把导入回执混入导出队列配额。 */
  default long countByOwnerIdAndKindAndStatusIn(
      Long ownerId, String kind, Collection<String> statuses) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .and(new QueryColumn("kind").eq(kind))
            .and(new QueryColumn("status").in(statuses)));
  }

  /** 持久队列协调只扫描有界未完成导出，不重放已提交导入。 */
  default List<BulkJob> findTop100ByKindAndStatusInOrderByIdAsc(
      String kind, Collection<String> statuses) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("kind").eq(kind))
            .and(new QueryColumn("status").in(statuses))
            .orderBy("id asc")
            .limit(100));
  }

  /** 作业取消、重试与完成按同一业务行串行更新，不能让旧线程覆盖终态。 */
  default Optional<BulkJob> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  /** 每轮最多清理一百条过期作业，避免文件清理持有无界数据库事务。 */
  default List<BulkJob> findTop100ByExpiresAtBefore(LocalDateTime now) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("expires_at").lt(now))
            .orderBy("id asc")
            .limit(100));
  }

  /** 仍未过期且引用该结果键的作业数；导出清理器据此保留活跃下载缓存。 */
  default long countActiveByKey(String resultKey) {
    return selectCountByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("result_key").eq(resultKey))
            .and(new QueryColumn("expires_at").gt(com.mayday.common.util.BusinessTime.now())));
  }

  /** 最近二十条固定由服务器传入本人 ID，不提供任意用户作业浏览接口。 */
  default List<BulkJob> findTop20ByOwnerIdOrderByIdDesc(Long ownerId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .orderBy("id desc")
            .limit(20));
  }
}
