package com.mayday.operations.web;

import com.mayday.operations.realtime.RealtimeStreams;
import com.mayday.security.AccessPolicy;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** 实时连接复用正常 Bearer 鉴权，禁用缓存与反向代理缓冲以保证心跳及时到达。 */
@RestController
@RequestMapping("/api/operations/realtime")
@RequiredArgsConstructor
public class RealtimeController {
  private final RealtimeStreams streams;
  private final AccessPolicy access;

  /** 实时连接只使用正常 Bearer 头鉴权，不接受主令牌 URL；缓存和代理缓冲关闭。 */
  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public ResponseEntity<SseEmitter> stream(
      @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
    if (!access.has("messages:view") && !access.has("requests:view"))
      throw new org.springframework.security.access.AccessDeniedException("没有消息或审批查看权限");
    if (!authorization.startsWith("Bearer "))
      throw new org.springframework.security.access.AccessDeniedException("请使用会话令牌认证");
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Accel-Buffering", "no")
        .body(streams.open(authorization.substring(7)));
  }
}
