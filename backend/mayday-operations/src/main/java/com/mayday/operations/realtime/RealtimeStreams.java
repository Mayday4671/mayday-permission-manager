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
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 单实例 SSE 通道：仅向登录会话对应账号发送刷新提示，最多每账号 4 条、全站 500 条连接。 每次发送和心跳都重新核验会话及当前权限；撤销会话或权限后不再推送。连接五分钟轮换，
 * 前端重连时重新拉取数据，服务重启期间仍由轮询兜底。多实例部署应替换事件分发为共享消息总线。
 */
@Service
@RequiredArgsConstructor
public class RealtimeStreams {
  private static final long CONNECTION_TIMEOUT_MS = 300_000L;
  private final TokenService tokens;
  private final AccessPolicy access;
  private final Map<String, Connection> connections = new ConcurrentHashMap<>();

  /** 连接仅在进程内保存原令牌用于重新核验，不序列化、不记录日志、不传回客户端。 */
  private record Connection(String id, Long userId, String token, SseEmitter emitter) {}

  /** 主令牌只从 Authorization 头取得，不接受 URL 参数或匿名订阅。 */
  public synchronized SseEmitter open(String token) {
    SysUser user = tokens.authenticate(token).orElseThrow(() -> new BusinessException("会话已失效"));
    if (!authorized(user))
      throw new org.springframework.security.access.AccessDeniedException("没有消息或审批查看权限");
    if (connections.size() >= 500
        || connections.values().stream()
                .filter(connection -> connection.userId().equals(user.getId()))
                .count()
            >= 4) throw new BusinessException("实时连接数量过多，请关闭重复打开的后台窗口");
    SseEmitter emitter = new SseEmitter(CONNECTION_TIMEOUT_MS);
    String id = UUID.randomUUID().toString();
    Connection connection = new Connection(id, user.getId(), token, emitter);
    connections.put(id, connection);
    emitter.onCompletion(() -> connections.remove(id));
    emitter.onTimeout(() -> close(connection));
    emitter.onError(error -> connections.remove(id));
    send(connection, "ready", Set.of());
    return emitter;
  }

  private boolean authorized(SysUser user) {
    return access.hasFor(user, "messages:view") || access.hasFor(user, "requests:view");
  }

  private void close(Connection connection) {
    connections.remove(connection.id());
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

  /** 回滚的发布不会进入该监听器；没有事务的纯刷新事件允许直接发送。 */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
  public void committed(RealtimeEvents.Change change) {
    connections.values().stream()
        .filter(connection -> change.recipientIds().contains(connection.userId()))
        .forEach(connection -> safelySend(connection, "changed", change.topics()));
  }

  /** 心跳同时清理已注销和过期会话，不依赖客户端是否主动关闭。 */
  @Scheduled(fixedDelay = 10_000L)
  public void heartbeat() {
    connections.values().forEach(connection -> safelySend(connection, "heartbeat", Set.of()));
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
