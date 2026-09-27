package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.security.SlideCaptchaService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 匿名登录辅助接口；不返回答案，不查询账号存在性，图片及凭证禁止缓存。 */
@RestController
@RequestMapping("/api/auth/captcha")
@RequiredArgsConstructor
public class CaptchaController {
  private final SlideCaptchaService captcha;

  public record ChallengeRequest(@NotBlank @Size(max = 64) String username) {}

  public record VerifyRequest(
      @NotBlank @Size(max = 64) String challengeId,
      @NotBlank @Size(max = 64) String username,
      @NotNull @Min(0) @Max(272) Integer x,
      @NotNull @Min(0) @Max(120000) Long elapsedMs) {}

  @PostMapping("/challenge")
  public ApiResponse<?> challenge(
      @Valid @RequestBody ChallengeRequest body,
      HttpServletRequest request,
      HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store");
    return ApiResponse.ok(captcha.issue(body.username(), request.getRemoteAddr()));
  }

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
