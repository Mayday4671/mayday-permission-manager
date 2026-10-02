package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.security.SlideCaptchaService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 匿名登录辅助接口；不返回答案，不查询账号存在性，图片及凭证禁止缓存。 */
@RestController
@RequestMapping("/api/auth/captcha")
@RequiredArgsConstructor
public class CaptchaController {
  private final SlideCaptchaService captcha;

  /** 发起挑战所绑定的账号名；接口不据此判断或透露账号是否存在。 */
  public record ChallengeRequest(@NotBlank @Size(max = 64) String username) {}

  /** 用户完成滑动的位置和耗时；答案、来源绑定、有效期及一次性消费规则均由服务端验证。 */
  public record VerifyRequest(
      @NotBlank @Size(max = 64) String challengeId,
      @NotBlank @Size(max = 64) String username,
      @NotNull @Min(0) @Max(272) Integer x,
      @NotNull @Min(0) @Max(120000) Long elapsedMs) {}

  /** 生成绑定账号和请求来源的挑战图片，响应禁止缓存且不包含目标位置答案。 */
  @PostMapping("/challenge")
  public ApiResponse<?> challenge(
      @Valid @RequestBody ChallengeRequest body,
      HttpServletRequest request,
      HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store");
    return ApiResponse.ok(captcha.issue(body.username(), request.getRemoteAddr()));
  }

  /** 验证挑战并签发短期一次性凭证；凭证还需在真正登录请求中被服务端消费。 */
  @PostMapping("/verify")
  public ApiResponse<?> verify(
      @Valid @RequestBody VerifyRequest body,
      HttpServletRequest request,
      HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store");
    return ApiResponse.ok(
        captcha.verify(
            body.challengeId(),
            body.username(),
            request.getRemoteAddr(),
            body.x(),
            body.elapsedMs()));
  }
}
