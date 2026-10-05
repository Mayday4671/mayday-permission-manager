package com.mayday.identity;

import com.mayday.common.ApiResponse;
import com.mayday.security.AccessPolicy;
import com.mayday.web.Contracts.LoginView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 企业登录/MFA 边界：只有选项、登录启动/回调及 MFA 登录验证公开；绑定和管理始终取本人身份。 */
@RestController
@RequestMapping("/api/auth/identity")
@RequiredArgsConstructor
public class IdentityController {
  private final MfaService mfa;
  private final OidcService oidc;
  private final AccessPolicy access;
  private final Environment environment;

  /** 敏感身份变更必须当场证明本地密码，已开通 MFA 时同时提交一次性因素。 */
  public record Proof(@NotBlank @Size(max = 72) String password, @Size(max = 64) String factor) {}

  /** 管理恢复不能省略理由，目标范围和账号授权等级由服务端再次检查。 */
  public record Recovery(
      @NotBlank @Size(max = 72) String password,
      @Size(max = 64) String factor,
      @NotBlank @Size(max = 300) String reason) {}

  /** 首因素已通过的短期挑战，不接受用户 ID、角色或启用标记。 */
  public record Verify(
      @NotBlank @Size(max = 64) String challengeId, @NotBlank @Size(max = 64) String factor) {}

  /** 提供方只允许部署注册标识，任意 callback URL/issuer 不能由页面传入。 */
  public record Start(@NotBlank @Size(max = 32) String providerId) {}

  /** 绑定以当前会话固定本人，显式再次校验本地密码和现有 MFA。 */
  public record Bind(
      @NotBlank @Size(max = 32) String providerId,
      @NotBlank @Size(max = 72) String password,
      @Size(max = 64) String factor) {}

  /** 授权回调只接收短期 code/state；服务端同时要求 HttpOnly 浏览器关联，绝不接受企业角色。 */
  public record Callback(
      @NotBlank @Size(max = 64) String state, @NotBlank @Size(max = 4096) String code) {}

  /** 对外授权 URL 不包含浏览器关联秘密，cookie 由服务端写入。 */
  public record Authorization(String authorizationUrl) {}

  /** 匿名只能读取已启用名称，不返回客户端密钥、企业内网地址或本地账号映射。 */
  @GetMapping("/providers")
  public ApiResponse<List<OidcService.ProviderView>> providers() {
    return ApiResponse.ok(oidc.providers());
  }

  /** 本人可读的 MFA 状态，不输出密钥、恢复码明文或持久散列。 */
  @GetMapping("/mfa")
  public ApiResponse<MfaService.Status> status() {
    return ApiResponse.ok(mfa.status(access.current().getId()));
  }

  /** 本地或企业首因素证明后的第二阶段，成功前不能取得业务 Bearer 会话。 */
  @PostMapping("/mfa/verify")
  public ApiResponse<LoginView> verify(
      @Valid @RequestBody Verify body, HttpServletRequest request) {
    return ApiResponse.ok(
        mfa.completeLogin(
            body.challengeId,
            body.factor,
            request.getRemoteAddr(),
            request.getHeader("User-Agent")));
  }

  /** 生成待确认密钥供认证器扫码；保存未完成不改变账号 MFA 状态。 */
  @PostMapping("/mfa/enroll")
  public ApiResponse<MfaService.Enrollment> enroll(
      @Valid @RequestBody Proof body, HttpServletRequest request) {
    return ApiResponse.ok(
        mfa.enroll(access.current().getId(), body.password, request.getRemoteAddr()));
  }

  /** 真实 OTP 确认开通，返回仅此次可见的恢复码并撤销旧会话。 */
  @PostMapping("/mfa/confirm")
  public ApiResponse<List<String>> confirm(
      @Valid @RequestBody Verify body, HttpServletRequest request) {
    return ApiResponse.ok(
        mfa.confirm(
            access.current().getId(), body.challengeId, body.factor, request.getRemoteAddr()));
  }

  /** 密码和现有因素确认后重新生成恢复码，旧组与旧会话原子失效。 */
  @PostMapping("/mfa/recovery")
  public ApiResponse<List<String>> recovery(
      @Valid @RequestBody Proof body, HttpServletRequest request) {
    return ApiResponse.ok(
        mfa.regenerate(
            access.current().getId(), body.password, body.factor, request.getRemoteAddr()));
  }

  /** 关闭需要本人密码和已开通因素，不能提交目标 ID 关闭他人 MFA。 */
  @PostMapping("/mfa/disable")
  public ApiResponse<Void> disable(@Valid @RequestBody Proof body, HttpServletRequest request) {
    mfa.disable(access.current().getId(), body.password, body.factor, request.getRemoteAddr());
    return ApiResponse.ok(null);
  }

  /** 只对可管理账号执行 MFA 恢复；具有角色编辑或登录权限并不自动拥有此操作。 */
  @PostMapping("/users/{id}/mfa/reset")
  public ApiResponse<Void> reset(
      @PathVariable Long id, @Valid @RequestBody Recovery body, HttpServletRequest request) {
    mfa.administrativeReset(id, body.password, body.factor, body.reason, request.getRemoteAddr());
    return ApiResponse.ok(null);
  }

  /** 登录启动创建 state/nonce/PKCE，不创建本地账号；cookie 仅关联回调，不参与业务认证。 */
  @PostMapping("/oidc/start")
  public ApiResponse<Authorization> start(
      @Valid @RequestBody Start body, HttpServletRequest request, HttpServletResponse response) {
    return authorize(
        oidc.begin(body.providerId, false, null, null, null, null, request.getRemoteAddr()),
        response);
  }

  /** 企业身份绑定必须来自当前有效本地会话并再次验证，回调不能跨账号或已撤销会话执行。 */
  @PostMapping("/oidc/bind")
  public ApiResponse<Authorization> bind(
      @Valid @RequestBody Bind body, HttpServletRequest request, HttpServletResponse response) {
    return authorize(
        oidc.begin(
            body.providerId,
            true,
            access.current().getId(),
            body.password,
            body.factor,
            bearer(request),
            request.getRemoteAddr()),
        response);
  }

  /** 完成一次性 code 交换与完整 ID token 校验，响应从不回传企业访问/刷新令牌。 */
  @PostMapping("/oidc/complete")
  public ApiResponse<OidcService.Completion> complete(
      @Valid @RequestBody Callback body,
      @CookieValue(value = "mayday.oidc", required = false) String browser,
      HttpServletRequest request,
      HttpServletResponse response) {
    var result =
        oidc.complete(
            body.state,
            body.code,
            browser,
            bearer(request),
            request.getRemoteAddr(),
            request.getHeader("User-Agent"));
    response.addHeader(HttpHeaders.SET_COOKIE, cookie("", 0).toString());
    return ApiResponse.ok(result);
  }

  /** 查询当前账号已绑定方式，不泄露企业主体 ID 或其他本地账号映射。 */
  @GetMapping("/bindings")
  public ApiResponse<List<OidcService.Binding>> bindings() {
    return ApiResponse.ok(oidc.bindings(access.current().getId()));
  }

  /** 密码/MFA 再认证确认解绑并撤销会话，保留经证明的本地登录渠道。 */
  @PostMapping("/bindings/{id}/remove")
  public ApiResponse<Void> remove(
      @PathVariable String id, @Valid @RequestBody Proof body, HttpServletRequest request) {
    oidc.unbind(access.current().getId(), id, body.password, body.factor, request.getRemoteAddr());
    return ApiResponse.ok(null);
  }

  private ApiResponse<Authorization> authorize(
      OidcService.Start start, HttpServletResponse response) {
    response.addHeader(HttpHeaders.SET_COOKIE, cookie(start.browserCookie(), 300).toString());
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    return ApiResponse.ok(new Authorization(start.authorizationUrl()));
  }

  private ResponseCookie cookie(String value, long maxAge) {
    return ResponseCookie.from("mayday.oidc", value)
        .httpOnly(true)
        .secure(environment.getProperty("mayday.deployment.production", Boolean.class, false))
        .sameSite("Lax")
        .path("/api/auth/identity/oidc")
        .maxAge(maxAge)
        .build();
  }

  private static String bearer(HttpServletRequest request) {
    String value = request.getHeader(HttpHeaders.AUTHORIZATION);
    return value != null && value.startsWith("Bearer ") ? value.substring(7) : null;
  }
}
