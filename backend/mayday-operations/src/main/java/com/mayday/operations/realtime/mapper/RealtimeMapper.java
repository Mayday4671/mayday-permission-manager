package com.mayday.operations.realtime.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 实时刷新日志与连接配额表的 SQL 收口：跨实例守卫行锁、固定配额上限和限时清理保持原有锁序； 语句集中在本层，服务只负责事件白名单与事务边界。 */
@Mapper
public interface RealtimeMapper {
  /** 顺序守卫持有到业务提交，消费者不会跳过尚未提交的低 ID。 */
  default void lockEventGuard() {
    Db.selectObject("select id from sys_realtime_guard where id=1 for update");
  }

  /** 追加一条刷新提示；接收账号与白名单主题由调用方裁剪。 */
  default void appendEvent(long userId, String topics) {
    Db.updateBySql(
        "insert into sys_realtime_event(recipient_id,topics,created_at) values(?,?,current_timestamp(3))",
        userId,
        topics);
  }

  /** 当前日志尾部；新实例从这里开始消费。 */
  default long latest() {
    return ((Number) Db.selectObject("select coalesce(max(id),0) from sys_realtime_event"))
        .longValue();
  }

  /** 按游标批量读取已提交提示，单批 200 条封顶。 */
  default List<Row> after(long cursor) {
    return Db.selectListBySql(
        "select id,recipient_id,topics from sys_realtime_event where id>? order by id limit 200",
        cursor);
  }

  /** 连接注册前锁定共享守卫并清理死连接，配额上限跨进程一致。 */
  default void lockConnectionGuard() {
    Db.selectObject("select id from sys_security_guard where id=1 for update");
    Db.updateBySql("delete from sys_realtime_connection where expires_at<=current_timestamp(3)");
  }

  /** 全站与单账号连接数；上限检查在读锁后执行。 */
  default long countConnections() {
    return ((Number) Db.selectObject("select count(*) from sys_realtime_connection")).longValue();
  }

  /** 单账号连接数。 */
  default long countConnectionsOf(long userId) {
    return ((Number)
            Db.selectObject("select count(*) from sys_realtime_connection where user_id=?", userId))
        .longValue();
  }

  /** 注册新连接；有效期固定 30 秒由心跳续期。 */
  default void insertConnection(String id, long userId) {
    Db.updateBySql(
        "insert into sys_realtime_connection(id,user_id,expires_at) values(?,?,timestampadd(second,30,current_timestamp"
            + "(3)))",
        id,
        userId);
  }

  /** 原连接过期不可迟到续命；影响行数即结果。 */
  default int renew(String id) {
    return Db.updateBySql(
        "update sys_realtime_connection set expires_at=timestampadd(second,30,current_timestamp(3)) where id=? and "
            + "expires_at>current_timestamp(3)",
        id);
  }

  /** 正常关闭精确释放本条连接配额。 */
  default void remove(String id) {
    Db.updateBySql("delete from sys_realtime_connection where id=?", id);
  }

  /** 定时清理一天前提示与死连接；删除量有界避免长事务。 */
  default void cleanup() {
    Db.updateBySql(
        "delete from sys_realtime_event where created_at<timestampadd(day,-1,current_timestamp(3)) limit 1000");
    Db.updateBySql("delete from sys_realtime_connection where expires_at<=current_timestamp(3)");
  }
}
