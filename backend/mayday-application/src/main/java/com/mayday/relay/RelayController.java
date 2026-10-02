package com.mayday.relay;

import com.mayday.common.*;
import com.mayday.netty.RelayConfig;
import com.mayday.security.AccessPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 三个独立权限控制查看、配置、启停；不开放打流生成接口，不接受客户端传入运行状态或统计值。 */
@RestController
@RequestMapping("/api/relay")
@RequiredArgsConstructor
public class RelayController {
  private final RelayService service;
  private final AccessPolicy access;

  public record Edit(
      @NotBlank @Size(max = 64) String bindIp,
      int bindPort,
      @NotBlank @Size(max = 64) String targetIp,
      int targetPort,
      int receiveBufferMiB,
      int sendBufferMiB,
      int pendingMemoryMiB,
      @NotNull Long version,
      @Size(max = 64) String sendIp,
      Integer sendPort,
      @Size(max = 10) String transportMode) {
    /** 兼容 V16 请求：未传新增字段时仍由系统选择发送地址、端口和传输模式。 */
    public Edit {
      sendIp = sendIp == null ? "" : sendIp;
      sendPort = sendPort == null ? 0 : sendPort;
      transportMode = transportMode == null ? "AUTO" : transportMode;
    }
  }

  public record Start(@NotNull Long version) {}

  public record Stop(@NotNull @Size(max = 64) String runId) {}

  @GetMapping("/config")
  public ApiResponse<?> config() {
    return ApiResponse.ok(service.config());
  }

  @GetMapping("/stats")
  public ApiResponse<?> stats() {
    return ApiResponse.ok(service.stats());
  }

  @GetMapping("/interfaces")
  public ApiResponse<?> interfaces() {
    access.require("relay:view");
    return ApiResponse.ok(com.mayday.netty.LocalInterfaces.list());
  }

  @PutMapping("/config")
  public ApiResponse<?> save(@Valid @RequestBody Edit request) {
    // 在 IP/网卡校验前先鉴权，未授权用户不能利用校验结果探测服务器接口。
    access.require("relay:view");
    access.require("relay:configure");
    try {
      return ApiResponse.ok(
          service.save(
              new RelayConfig(
                  request.bindIp(),
                  request.bindPort(),
                  request.targetIp(),
                  request.targetPort(),
                  request.receiveBufferMiB(),
                  request.sendBufferMiB(),
                  request.pendingMemoryMiB(),
                  request.sendIp(),
                  request.sendPort(),
                  request.transportMode()),
              request.version()));
    } catch (IllegalArgumentException error) {
      throw new BusinessException(error.getMessage());
    }
  }

  @PostMapping("/start")
  public ApiResponse<?> start(@Valid @RequestBody Start request) {
    return ApiResponse.ok(service.start(request.version()));
  }

  @PostMapping("/stop")
  public ApiResponse<?> stop(@Valid @RequestBody Stop request) {
    return ApiResponse.ok(service.stop(request.runId()));
  }
}
