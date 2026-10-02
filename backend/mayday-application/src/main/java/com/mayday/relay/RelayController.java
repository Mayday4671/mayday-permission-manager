package com.mayday.relay;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.netty.RelayConfig;
import com.mayday.security.AccessPolicy;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 三个独立权限控制查看、配置、启停；不开放打流生成接口，不接受客户端传入运行状态或统计值。 */
@RestController
@RequestMapping("/api/relay")
@RequiredArgsConstructor
public class RelayController {
  private final RelayService service;
  private final AccessPolicy access;

  /** 单接收端与单目标转发配置，支持多网卡独立指定收/发地址与内存上限。 端口、网卡归属和传输模式由 RelayConfig 验证，version 阻止覆盖并发配置。 */
  @Schema(name = "RelaySettingsEdit")
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

  /** 启动仅使用服务端保存的配置，版本不匹配时拒绝运行过期页面所见配置。 */
  public record Start(@NotNull Long version) {}

  /** 停止必须指向本次运行标识，避免过期页面误停其他操作者刚启动的实例。 */
  public record Stop(@NotNull @Size(max = 64) String runId) {}

  /** 转发配置读取权限由服务层统一检查，返回运行状态供界面限制修改。 */
  @GetMapping("/config")
  public ApiResponse<?> config() {
    return ApiResponse.ok(service.config());
  }

  /** 返回当前运行的真实收发、积压、丢弃及速率快照，客户端不能修改统计值。 */
  @GetMapping("/stats")
  public ApiResponse<?> stats() {
    return ApiResponse.ok(service.stats());
  }

  /** 仅向有 relay:view 权限的用户公开本机可绑定网卡地址，不提供任意网络探测。 */
  @GetMapping("/interfaces")
  public ApiResponse<?> interfaces() {
    access.require("relay:view");
    return ApiResponse.ok(com.mayday.netty.LocalInterfaces.list());
  }

  /** 配置权限先于网卡校验执行，保存时检查停止状态和当前配置 version。 */
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

  /** 启动需要独立 relay:control 权限，由服务层验证版本和本机绑定可用性。 */
  @PostMapping("/start")
  public ApiResponse<?> start(@Valid @RequestBody Start request) {
    return ApiResponse.ok(service.start(request.version()));
  }

  /** 停止需要 relay:control 权限且运行标识匹配，返回最终快照以便核对收发计数。 */
  @PostMapping("/stop")
  public ApiResponse<?> stop(@Valid @RequestBody Stop request) {
    return ApiResponse.ok(service.stop(request.runId()));
  }
}
