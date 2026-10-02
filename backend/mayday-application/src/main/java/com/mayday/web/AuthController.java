package com.mayday.web;

import com.mayday.common.*;
import com.mayday.security.*;
import com.mayday.service.UserService;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import com.mayday.web.Contracts.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

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

  @PostMapping("/login")
  public ResponseEntity<ApiResponse<LoginView>> login(
      @Valid @RequestBody LoginRequest req, HttpServletRequest request) {
    request.setAttribute("audit.username", req.username());
    if (!throttle.allowed(request.getRemoteAddr(), req.username()))
      return ResponseEntity.status(429).body(ApiResponse.error("尝试次数过多，请 15 分钟后重试"));
    // 必须由服务端消费绑定账号/来源的一次性验证凭证；不能只依赖页面滑块状态。
    captcha.consume(req.captchaToken(), req.username(), request.getRemoteAddr());
    SysUser u = users.findByUsername(req.username()).orElse(null);
    // 未知账号使用固定的 BCrypt 散列进行比较，使错误账号和错误密码的耗时接近。
    String dummy = "$2a$12$8ZpvwmMhLv.sRn3dDrsmEeCXuqbzLtQdNlSNdLfRjDWoZeYmEDmea";
    boolean match =
        req.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 72
            && encoder.matches(req.password(), u == null ? dummy : u.getPasswordHash());
    if (u == null || !match || !u.isEnabled()) {
      throttle.failed(request.getRemoteAddr(), req.username());
      return ResponseEntity.status(401).body(ApiResponse.error("用户名或密码错误，或账号已停用"));
    }
    throttle.succeeded(request.getRemoteAddr(), req.username());
    request.setAttribute("audit.username", u.getUsername());
    return ResponseEntity.ok(
        ApiResponse.ok(
            new LoginView(
                tokens.issue(u, request.getRemoteAddr(), request.getHeader("User-Agent")))));
  }

  @GetMapping("/me")
  public ApiResponse<SessionView> me() {
    SysUser u = access.current();
    UserView user =
        UserView.from(
            u,
            u.getDepartmentId() == null
                ? "未分配"
                : entries.findById(u.getDepartmentId()).map(SystemEntry::getName).orElse("未分配"),
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

  @PostMapping("/logout")
  public ApiResponse<?> logout(@RequestHeader("Authorization") String authorization) {
    tokens.revoke(authorization.substring(7));
    return ApiResponse.ok(null);
  }

  @PutMapping("/profile")
  @Transactional
  public ApiResponse<?> profile(@Valid @RequestBody ProfileRequest req) {
    SysUser u = users.findById(access.current().getId()).orElseThrow();
    u.setNickname(req.nickname());
    u.setEmail(req.email());
    u.setPhone(req.phone());
    users.save(u);
    return ApiResponse.ok(null);
  }

  @PutMapping("/password")
  @Transactional
  public ApiResponse<?> password(@Valid @RequestBody PasswordRequest req) {
    SysUser u = users.findById(access.current().getId()).orElseThrow();
    if (!encoder.matches(req.oldPassword(), u.getPasswordHash()))
      throw new BusinessException("原密码不正确");
    UserService.validatePassword(req.newPassword());
    u.setPasswordHash(encoder.encode(req.newPassword()));
    users.save(u);
    tokens.revokeUser(u.getId());
    return ApiResponse.ok(null);
  }
}
