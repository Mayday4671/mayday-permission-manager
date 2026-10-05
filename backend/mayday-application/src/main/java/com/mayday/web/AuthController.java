package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.identity.MfaService;
import com.mayday.security.AccessPolicy;
import com.mayday.security.LoginThrottle;
import com.mayday.security.PermissionCatalog;
import com.mayday.security.SlideCaptchaService;
import com.mayday.security.TokenService;
import com.mayday.service.UserService;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.DataScope;
import com.mayday.web.Contracts.LoginRequest;
import com.mayday.web.Contracts.LoginView;
import com.mayday.web.Contracts.PasswordRequest;
import com.mayday.web.Contracts.ProfileRequest;
import com.mayday.web.Contracts.SessionView;
import com.mayday.web.Contracts.UserView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 认证与个人中心。个人资料不允许修改用户名、部门、角色或启用状态。 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final TokenService tokens;
  private final AccessPolicy access;
  private final LoginThrottle throttle;
  private final SlideCaptchaService captcha;
  private final EntryRepository entries;
  private final MfaService mfa;

  /** 消费账号及来源绑定的滑块凭证，限流并验证密码/启用状态后签发不透明会话令牌。 */
  @PostMapping("/login")
  public ResponseEntity<ApiResponse<LoginView>> login(
      @Valid @RequestBody LoginRequest body, HttpServletRequest request) {
    request.setAttribute("audit.username", body.username());
    if (!throttle.allowed(request.getRemoteAddr(), body.username()))
      return ResponseEntity.status(429).body(ApiResponse.error("尝试次数过多，请 15 分钟后重试"));
    // 必须由服务端消费绑定账号/来源的一次性验证凭证；不能只依赖页面滑块状态。
    captcha.consume(body.captchaToken(), body.username(), request.getRemoteAddr());
    SysUser account = users.findByUsername(body.username()).orElse(null);
    // 未知账号使用固定的 BCrypt 散列进行比较，使错误账号和错误密码的耗时接近。
    String dummyHash = "$2a$12$8ZpvwmMhLv.sRn3dDrsmEeCXuqbzLtQdNlSNdLfRjDWoZeYmEDmea";
    boolean matchesPassword =
        body.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 72
            && encoder.matches(
                body.password(), account == null ? dummyHash : account.getPasswordHash());
    if (account == null || !matchesPassword || !account.isEnabled()) {
      throttle.failed(request.getRemoteAddr(), body.username());
      return ResponseEntity.status(401).body(ApiResponse.error("用户名或密码错误，或账号已停用"));
    }
    throttle.succeeded(request.getRemoteAddr(), body.username());
    request.setAttribute("audit.username", account.getUsername());
    return ResponseEntity.ok(
        ApiResponse.ok(
            mfa.loginAfterPrimary(
                account, request.getRemoteAddr(), request.getHeader("User-Agent"))));
  }

  /** 读取真实当前账号和有效授权摘要；本人联系方式可见，但摘要不能代替业务接口授权。 */
  @GetMapping("/me")
  public ApiResponse<SessionView> me() {
    SysUser account = access.current();
    UserView user =
        UserView.from(
            account,
            account.getDepartmentId() == null
                ? "未分配"
                : entries
                    .findById(account.getDepartmentId())
                    .map(SystemEntry::getName)
                    .orElse("未分配"),
            true,
            true);
    // 数据范围摘要随权限目录扩展；真正的接口授权仍由 AccessPolicy 按记录计算。
    var dataScopes =
        PermissionCatalog.SCOPED_RESOURCES.stream()
            .filter(resource -> access.has(resource + ":view"))
            .collect(
                java.util.stream.Collectors.toMap(
                    resource -> resource,
                    resource ->
                        PermissionCatalog.SCOPES.contains(access.scope(resource))
                            ? DataScope.valueOf(access.scope(resource))
                            : DataScope.SELF));
    return ApiResponse.ok(new SessionView(user, access.permissions(), dataScopes, access.admin()));
  }

  /** 撤销当前认证过滤器已验证的 Bearer 会话，仅影响该令牌对应的登录。 */
  @PostMapping("/logout")
  public ApiResponse<?> logout(@RequestHeader("Authorization") String authorization) {
    tokens.revoke(authorization.substring(7));
    return ApiResponse.ok(null);
  }

  /** 当前账号只能修改本人资料白名单，目标 ID 固定来自认证上下文。 */
  @PutMapping("/profile")
  @Transactional
  public ApiResponse<?> profile(@Valid @RequestBody ProfileRequest body) {
    SysUser account = users.findById(access.current().getId()).orElseThrow();
    account.setNickname(body.nickname());
    account.setEmail(body.email());
    account.setPhone(body.phone());
    users.save(account);
    return ApiResponse.ok(null);
  }

  /** 校验原密码及新密码规则，保存 BCrypt 散列后撤销该用户所有已签发会话。 */
  @PutMapping("/password")
  @Transactional
  public ApiResponse<?> password(
      @Valid @RequestBody PasswordRequest body, HttpServletRequest request) {
    SysUser account = users.findById(access.current().getId()).orElseThrow();
    mfa.reauthenticate(account.getId(), body.oldPassword(), body.factor(), request.getRemoteAddr());
    if (!encoder.matches(body.oldPassword(), account.getPasswordHash()))
      throw new BusinessException("原密码不正确");
    UserService.validatePassword(body.newPassword());
    account.setPasswordHash(encoder.encode(body.newPassword()));
    users.save(account);
    tokens.revokeUser(account.getId());
    return ApiResponse.ok(null);
  }
}
