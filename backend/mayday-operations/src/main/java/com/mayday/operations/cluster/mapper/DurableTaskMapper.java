package com.mayday.operations.cluster.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import org.apache.ibatis.annotations.Mapper;

/**
 * 持久队列表的 SQL 收口：领取（SKIP LOCKED）、幂等入队（INSERT IGNORE）与租约原子更新都依赖 MySQL 专有语法，无法用 QueryWrapper
 * 等价表达；语句集中在本层，服务只保留锁顺序与事务编排。
 */
@Mapper
public interface DurableTaskMapper {
  /** 数据库毫秒时间戳；租约与退避不依赖主机时钟。 */
  default long nowMillis() {
    return ((Number)
            Db.selectObject("select cast(unix_timestamp(current_timestamp(3))*1000 as unsigned)"))
        .longValue();
  }

  /** 幂等入队：同键已存在时忽略插入，再锁定现有行校验内容一致。 */
  default void enqueue(String type, String key, String payload, int maxAttempts, long now) {
    Db.updateBySql(
        "insert ignore into sys_durable_task(task_type,business_key,payload,status,attempts,max_attempts,"
            + "next_attempt_at,created_at,updated_at) values(?,?,?,'QUEUED',0,?,?,?,?)",
        type,
        key,
        payload,
        maxAttempts,
        now,
        now,
        now);
  }

  /** 锁定并读取同键现有作业，供内容一致性校验。 */
  default Row lockByKey(String type, String key) {
    return Db.selectOneBySql(
        "select id,payload from sys_durable_task where task_type=? and business_key=? for update",
        type,
        key);
  }

  /** 领取一条到期作业；SKIP LOCKED 保证多实例互不阻塞。 */
  default Row claimRow(String type, String key, long now) {
    return Db.selectOneBySql(
        "select id,task_type,business_key,payload,attempts from sys_durable_task"
            + " where task_type=? and (? is null or business_key=?)"
            + " and ((status='QUEUED' and next_attempt_at<=?)"
            + " or (status='RUNNING' and lease_until<=?))"
            + " order by next_attempt_at,id limit 1 for update skip locked",
        type,
        key,
        key,
        now,
        now);
  }

  /** 重试上限以数据库配置为准，领取后立即复核。 */
  default int maxAttempts(long id) {
    return ((Number) Db.selectObject("select max_attempts from sys_durable_task where id=?", id))
        .intValue();
  }

  /** 达到重试上限直接终态失败，租约清空。 */
  default void markFailedByCap(long id, long now) {
    Db.updateBySql(
        "update sys_durable_task set status='FAILED',last_error='任务重试次数已达上限',lease_token=null,lease_until=null,"
            + "updated_at=? where id=?",
        now,
        id);
  }

  /** 领取成功写入新租约；实例标识隔离旧工作器。 */
  default void markRunning(
      long id, int attempt, String instance, String token, long leaseUntil, long now) {
    Db.updateBySql(
        "update sys_durable_task set status='RUNNING',attempts=?,lease_owner=?,lease_token=?,lease_until=?,"
            + "heartbeat_at=?,updated_at=? where id=?",
        attempt,
        instance,
        token,
        leaseUntil,
        now,
        now,
        id);
  }

  /** 心跳只延长仍有效的原租约；影响行数即结果。 */
  default int heartbeat(long id, String token, long leaseUntil, long now) {
    return Db.updateBySql(
        "update sys_durable_task set lease_until=?,heartbeat_at=?,updated_at=? where id=? and status='RUNNING' and "
            + "lease_token=? and lease_until>?",
        leaseUntil,
        now,
        now,
        id,
        token,
        now);
  }

  /** 持行锁复核租约有效性；fenced 提交前后各调用一次。 */
  default boolean validForUpdate(long id, String token, long now) {
    Row row =
        Db.selectOneBySql(
            "select status='RUNNING' and lease_token=? and lease_until>? as valid"
                + " from sys_durable_task where id=? for update",
            token,
            now,
            id);
    return row != null && Boolean.TRUE.equals(row.getBoolean("valid"));
  }

  /** 完成即清租约；旧令牌不能再改状态。 */
  default void markSucceeded(long id, long now) {
    Db.updateBySql(
        "update sys_durable_task set status='SUCCEEDED',lease_token=null,lease_until=null,last_error=null,updated_at=? "
            + "where id=?",
        now,
        id);
  }

  /** 失败或重排；退避上限 60 秒、指数叠加由调用方计算。 */
  default void markOutcome(long id, String status, String error, long nextAttemptAt, long now) {
    Db.updateBySql(
        "update sys_durable_task set status=?,lease_token=null,lease_until=null,last_error=?,next_attempt_at=?,"
            + "updated_at=? where id=?",
        status,
        error,
        nextAttemptAt,
        now,
        id);
  }

  /** 取消仍在排队或运行的作业；影响行数决定业务回执。 */
  default int cancelQueuedOrRunning(String type, String key, long now) {
    return Db.updateBySql(
        "update sys_durable_task set status='CANCELLED',lease_token=null,lease_until=null,updated_at=? where "
            + "task_type=? and business_key=? and status in ('QUEUED','RUNNING')",
        now,
        type,
        key);
  }

  /** 从终态恢复重试；尝试次数清零但保留作业身份。 */
  default int retryFailed(String type, String key, long now) {
    return Db.updateBySql(
        "update sys_durable_task set status='QUEUED',attempts=0,last_error=null,next_attempt_at=?,updated_at=? where "
            + "task_type=? and business_key=? and status in ('FAILED','CANCELLED')",
        now,
        now,
        type,
        key);
  }

  /** 锁定读取终态；取消/重试竞争时由行锁决定先后。 */
  default Row lockStatus(String type, String key) {
    return Db.selectOneBySql(
        "select status from sys_durable_task where task_type=? and business_key=? for update",
        type,
        key);
  }

  /** 按租约令牌统计运行中作业；导出清理器据此判断文件是否仍被工作器持有。 */
  default long countRunningByLease(String leaseToken) {
    return ((Number)
            Db.selectObject(
                "select count(*) from sys_durable_task where task_type='BULK_EXPORT' and"
                    + " lease_token=? and status='RUNNING' and lease_until>cast(unix_timestamp(current_timestamp(3))*1000"
                    + " as "
                    + "unsigned)",
                leaseToken))
        .longValue();
  }

  /** 无锁读取状态，仅用于业务协调自身进度展示。 */
  default String status(String type, String key) {
    Row row =
        Db.selectOneBySql(
            "select status from sys_durable_task where task_type=? and business_key=?", type, key);
    return row == null ? null : row.getString("status");
  }

  /** 短事务锁定队列行，业务回执随后同事务读取。 */
  default void lockRow(String type, String key) {
    Db.selectObject(
        "select id from sys_durable_task where task_type=? and business_key=? for update",
        type,
        key);
  }
}
