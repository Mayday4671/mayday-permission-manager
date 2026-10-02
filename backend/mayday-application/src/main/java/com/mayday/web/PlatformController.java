package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.ModuleSwitches;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 公开返回最小功能清单，不包含账号、权限授予结果、部署地址或任何配置密钥。 */
@RestController
@RequestMapping("/api/platform")
@RequiredArgsConstructor
public class PlatformController {
  private final ModuleSwitches modules;

  /** 前后端消费同一份有效开关，模块依赖已由服务端计算，客户端无需复制依赖规则。 */
  @GetMapping("/features")
  public ApiResponse<FeatureView> features() {
    return ApiResponse.ok(new FeatureView(modules.snapshot()));
  }

  public record FeatureView(Map<String, Boolean> modules) {}
}
