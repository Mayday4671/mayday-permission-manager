package com.mayday.operations.realtime;

import com.mayday.common.BusinessException;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 数据库刷新日志与跨实例连接配额。日志在原业务事务中插入，回滚业务不留刷新事件；每个实例独立读取已提交日志。 仅保存接收账号和资源名，SSE
 * 仍在发送时重新鉴权，不把表单正文、联系方式或令牌复制进消息总线。
 */
@Service
public class RealtimeJournal {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transaction;

  public RealtimeJournal(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    transaction = new TransactionTemplate(manager);
    transaction.setTimeout(10);
  }

  /** 接收者来自已授权业务结果；未知主题不记录，不能把任意字符串变成旁路业务数据。 */
  public void append(Collection<Long> users, String... topics) {
    String visible =
        java.util.Arrays.stream(topics)
            .filter(Set.of("messages", "requests")::contains)
            .distinct()
            .sorted()
            .collect(Collectors.joining(","));
    if (visible.isEmpty() || users.isEmpty()) return;
    transaction.executeWithoutResult(
        status -> {
          // 顺序守卫持有到业务提交，避免后分配的 ID 先提交、消费者跳过尚未提交的低 ID。
          jdbc.queryForObject(
              "select id from sys_realtime_guard where id=1 for update", Integer.class);
          for (Long user : Set.copyOf(users))
            jdbc.update(
                "insert into sys_realtime_event(recipient_id,topics,created_at) values(?,?,current_timestamp(3))",
                user,
                visible);
        });
  }

  /** 新实例从当前尾部开始；客户端收到 ready 后会重新拉取自身状态，不需重放停机前过期提示。 */
  public long latest() {
    return jdbc.queryForObject("select coalesce(max(id),0) from sys_realtime_event", Long.class);
  }

  /** 已提交的最小刷新提示；消费游标、接收账号及白名单主题，不包含业务正文。 */
  public record Event(long id, long userId, Set<String> topics) {}

  /** 单批最多 200 条，每个实例独立游标；不得删掉其他实例尚在消费的最近记录。 */
  public List<Event> after(long cursor) {
    return jdbc.query(
        "select id,recipient_id,topics from sys_realtime_event where id>? order by id limit 200",
        (row, number) ->
            new Event(row.getLong(1), row.getLong(2), Set.of(row.getString(3).split(","))),
        cursor);
  }

  /** 全局守卫使账号四连接及全站五百连接上限跨进程一致；死实例连接 30 秒后自然释放。 */
  public void register(String id, Long userId) {
    transaction.executeWithoutResult(
        status -> {
          jdbc.queryForObject(
              "select id from sys_security_guard where id=1 for update", Integer.class);
          jdbc.update("delete from sys_realtime_connection where expires_at<=current_timestamp(3)");
          long total =
              jdbc.queryForObject("select count(*) from sys_realtime_connection", Long.class);
          long own =
              jdbc.queryForObject(
                  "select count(*) from sys_realtime_connection where user_id=?",
                  Long.class,
                  userId);
          if (total >= 500 || own >= 4) throw new BusinessException("实时连接数量过多，请关闭重复打开的后台窗口");
          jdbc.update(
              "insert into sys_realtime_connection(id,user_id,expires_at) values(?,?,timestampadd(second,30,current_timestamp(3)))",
              id,
              userId);
        });
  }

  /** 原连接过期不可迟到续命；客户端重连再次通过正常会话及配额校验。 */
  public boolean renew(String id) {
    return jdbc.update(
            "update sys_realtime_connection set expires_at=timestampadd(second,30,current_timestamp(3)) where id=? and expires_at>current_timestamp(3)",
            id)
        == 1;
  }

  /** 正常关闭精确释放本条连接配额，不删除同账号其他实例的连接。 */
  public void remove(String id) {
    jdbc.update("delete from sys_realtime_connection where id=?", id);
  }

  /** 日志只作在线刷新，正文及未读状态仍在业务表持久保留；仅清理一天前的提示和死连接。 */
  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60000)
  public void cleanup() {
    jdbc.update(
        "delete from sys_realtime_event where created_at<timestampadd(day,-1,current_timestamp(3)) limit 1000");
    jdbc.update("delete from sys_realtime_connection where expires_at<=current_timestamp(3)");
  }
}
