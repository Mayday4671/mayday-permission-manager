package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.operations.monitor.MonitorService;
import com.mayday.security.AccessPolicy;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 只暴露运行指标，不返回环境变量、连接字符串、线程栈或机器文件路径。 */
@RestController
@RequestMapping("/api/operations/monitor")
@RequiredArgsConstructor
public class MonitorController {
  private final AccessPolicy access;
  private final MonitorService service;
  private final com.mayday.operations.service.AlertRecipients alertRecipients;

  /** 实时采样需要查看权，不能用配置权限代替指标查看权限。 */
  @GetMapping
  public ApiResponse<MonitorService.Snapshot> status() {
    access.require("monitor:view");
    return ApiResponse.ok(service.sample());
  }

  /** 按5至60分钟窗口读取有上限的真实采样历史，查看权限由服务独立验证；没有采样时返回空列表。 */
  @GetMapping("/history")
  public ApiResponse<List<MonitorService.HistoryPoint>> history(
      @RequestParam(defaultValue = "60") int minutes) {
    return ApiResponse.ok(service.history(minutes));
  }

  /** 查看当前告警策略及版本，不把内部上次领取时间当作可编辑配置。 */
  @GetMapping("/policy")
  public ApiResponse<MonitorService.PolicyView> policy() {
    return ApiResponse.ok(service.policy());
  }

  /** 校验阈值并提交带版本的配置更改，独立配置权限不能替代查看权限。 */
  @PutMapping("/policy")
  public ApiResponse<MonitorService.PolicyView> configure(
      @Valid @RequestBody MonitorService.EditPolicy request) {
    return ApiResponse.ok(service.configure(request));
  }

  /** 配置权限下获取最小接收人候选，实际接收人必须拥有监控查看权。 */
  @GetMapping("/recipients")
  public ApiResponse<List<com.mayday.operations.service.AlertRecipients.Option>> recipients(
      @RequestParam(defaultValue = "") String keyword) {
    access.require("monitor:configure");
    return ApiResponse.ok(alertRecipients.list("monitor:view", keyword));
  }
}
