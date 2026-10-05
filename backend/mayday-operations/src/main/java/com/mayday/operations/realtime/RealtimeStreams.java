package com.mayday.operations.realtime;

import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.security.TokenService;
import com.mayday.system.model.SysUser;
import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 跨实例 SSE 通道：已提交刷新日志通过数据库共享，仅向登录会话对应账号推送资源提示。 每次发送与心跳都重新核验会话及当前权限；连接配额使用共享登记，故障登记自动过期。 */
@Service
@RequiredArgsConstructor
public class RealtimeStreams {
  private static final long CONNECTION_TIMEOUT_MS = 300_000L;
  private final TokenService tokens;
  private final AccessPolicy access;
  private final RealtimeJournal journal;
  private long cursor;
  private final Map<String, Connection> connections = new ConcurrentHashMap<>();

  /** 连接仅在进程内保存原令牌用于重新核验，不序列化、不记录日志、不传回客户端。 */
  private record Connection(String id, Long userId, String token, SseEmitter emitter) {}

  /** 主令牌只从 Authorization 头取得，不接受 URL 参数或匿名订阅。 */
  public synchronized SseEmitter open(String token) {
    SysUser user = tokens.authenticate(token).orElseThrow(() -> new BusinessException("会话已失效"));
    if (!authorized(user))
      throw new org.springframework.security.access.AccessDeniedException("没有消息或审批查看权限");
    SseEmitter emitter = new SseEmitter(CONNECTION_TIMEOUT_MS);
    String id = UUID.randomUUID().toString();
    journal.register(id, user.getId());
    Connection connection = new Connection(id, user.getId(), token, emitter);
    connections.put(id, connection);
    emitter.onCompletion(() -> remove(connection));
    emitter.onTimeout(() -> close(connection));
    emitter.onError(error -> remove(connection));
    send(connection, "ready", Set.of());
    return emitter;
  }

  private boolean authorized(SysUser user) {
    return access.hasFor(user, "messages:view") || access.hasFor(user, "requests:view");
  }

  private void remove(Connection connection) {
    connections.remove(connection.id());
    try {
      journal.remove(connection.id());
    } catch (RuntimeException unavailable) {
      // 数据库故障不阻止本机断流；共享登记会在30秒后到期，不能把关闭回调变成业务异常。
    }
  }

  private void close(Connection connection) {
    remove(connection);
    connection.emitter().complete();
  }

  private void send(Connection connection, String event, Set<String> topics) {
    SysUser user = tokens.authenticate(connection.token()).orElse(null);
    if (user == null || !user.getId().equals(connection.userId()) || !authorized(user)) {
      close(connection);
      return;
    }
    // 流没有业务正文。主题还要按当前权限裁剪，避免撤销一种权限后泄露该领域变化。
    Set<String> visibleTopics =
        topics.stream()
            .filter(
                topic ->
                    "messages".equals(topic)
                        ? access.hasFor(user, "messages:view")
                        : "requests".equals(topic) && access.hasFor(user, "requests:view"))
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    if ("changed".equals(event) && visibleTopics.isEmpty()) return;
    try {
      connection
          .emitter()
          .send(
              SseEmitter.event()
                  .name(event)
                  .data(
                      Map.of("topics", visibleTopics, "time", Instant.now().toString()),
                      MediaType.APPLICATION_JSON));
    } catch (IOException | IllegalStateException error) {
      close(connection);
    }
  }

  /** 本机发送只读取提交后的日志；本方法复用于测试资源裁剪，不直接监听未提交业务事件。 */
  public void committed(RealtimeEvents.Change change) {
    connections.values().stream()
        .filter(connection -> change.recipientIds().contains(connection.userId()))
        .forEach(connection -> safelySend(connection, "changed", change.topics()));
  }

  /** 已提交事件在各节点独立消费，事务回滚不会进入该查询；只投递本节点实际连接。 */
  @Scheduled(fixedDelayString = "${mayday.realtime.poll-ms:500}")
  public synchronized void poll() {
    if (connections.isEmpty()) {
      cursor = journal.latest();
      return;
    }
    for (var event : journal.after(cursor)) {
      committed(new RealtimeEvents.Change(Set.of(event.userId()), event.topics()));
      cursor = event.id();
    }
  }

  /** 心跳同时清理已注销和过期会话，不依赖客户端是否主动关闭。 */
  @Scheduled(fixedDelay = 10_000L)
  public void heartbeat() {
    connections
        .values()
        .forEach(
            connection -> {
              try {
                if (journal.renew(connection.id())) safelySend(connection, "heartbeat", Set.of());
                else close(connection);
              } catch (RuntimeException unavailable) {
                close(connection);
              }
            });
  }

  /** 正常停机先关闭本机连接并精确释放登记；硬故障仍由数据库过期时间回收。 */
  @jakarta.annotation.PreDestroy
  public void stop() {
    connections.values().forEach(this::close);
  }

  /** 数据库暂不可用时关闭流并由客户端重连，不能把已提交业务的刷新失败变成业务失败。 */
  private void safelySend(Connection connection, String event, Set<String> topics) {
    try {
      send(connection, event, topics);
    } catch (RuntimeException error) {
      close(connection);
    }
  }
}
