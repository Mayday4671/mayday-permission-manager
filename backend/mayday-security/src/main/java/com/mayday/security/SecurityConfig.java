package com.mayday.security;

import com.mayday.common.ModuleSwitches;
import com.mayday.system.model.AuditLog;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.AuditRepository;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

/** 同源 Bearer API：不使用 Cookie 登录，禁用服务端 HTTP Session，所有业务接口默认需要认证。 */
@Configuration
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {
  private final TokenService tokens;
  private final AuditRepository audits;
  private final ModuleSwitches modules;

  /** 密码仅使用成本 12 的 BCrypt；原密码只在登录或设置密码的请求中短暂使用。 */
  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  /** 明确关闭框架生成的默认演示用户，本平台只接受数据库会话认证。 */
  @Bean
  UserDetailsService userDetailsService() {
    return username -> {
      throw new UsernameNotFoundException("使用会话令牌认证");
    };
  }

  /** 首次请求默认鉴权，公开接口逐条放行；ASYNC 只继续已建立的流，不成为首次请求的匿名入口。 SSE 每次心跳和发送由实时模块重新校验会话，不能依赖长连接建立时的权限快照。 */
  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http.csrf(configurer -> configurer.disable())
        .cors(configurer -> configurer.disable())
        .sessionManagement(
            sessions -> sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            authorizationRules ->
                authorizationRules
                    .dispatcherTypeMatchers(DispatcherType.ASYNC)
                    .permitAll()
                    .requestMatchers(
                        "/api/auth/login",
                        "/api/auth/captcha/challenge",
                        "/api/auth/captcha/verify",
                        "/api/auth/identity/providers",
                        "/api/auth/identity/oidc/start",
                        "/api/auth/identity/oidc/complete",
                        "/api/auth/identity/mfa/verify",
                        "/api/platform/features",
                        "/api/public/**",
                        "/actuator/health",
                        "/actuator/health/liveness",
                        "/actuator/health/readiness",
                        "/error")
                    .permitAll()
                    .requestMatchers("/api/platform/openapi", "/api/platform/openapi/**")
                    .access(
                        (authentication, context) ->
                            new AuthorizationDecision(
                                authentication.get().getPrincipal() instanceof SysUser user
                                    && user.getRoles().stream()
                                        .anyMatch(
                                            role ->
                                                role.isEnabled()
                                                    && "admin".equals(role.getCode()))))
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(
            exceptions ->
                exceptions
                    .authenticationEntryPoint(
                        (request, response, error) -> json(response, 401, "请先登录或重新登录"))
                    .accessDeniedHandler(
                        (request, response, error) -> json(response, 403, "没有此操作的权限")))
        .addFilterBefore(
            new OncePerRequestFilter() {
              @Override
              protected void doFilterInternal(
                  HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                  throws ServletException, IOException {
                long start = System.nanoTime();
                // 在认证与业务控制器之前阻断关闭模块，包括管理员、附件及猜测 ID 的直接请求。
                if (!modules.pathEnabled(request.getServletPath())) {
                  json(response, 404, "该功能未启用");
                  return;
                }
                String authorizationHeader = request.getHeader("Authorization");
                // 仅接受请求头中的不透明令牌，URL 查询参数和 Cookie 均不参与身份恢复。
                if (authorizationHeader != null && authorizationHeader.startsWith("Bearer "))
                  tokens
                      .authenticate(authorizationHeader.substring(7))
                      .ifPresent(
                          user ->
                              SecurityContextHolder.getContext()
                                  .setAuthentication(
                                      new UsernamePasswordAuthenticationToken(
                                          user, null, List.of())));
                String username =
                    SecurityContextHolder.getContext().getAuthentication() == null
                        ? "anonymous"
                        : ((SysUser)
                                SecurityContextHolder.getContext()
                                    .getAuthentication()
                                    .getPrincipal())
                            .getUsername();
                try {
                  chain.doFilter(request, response);
                } finally {
                  // 不记录请求体、Authorization 头及查询参数；失败请求同样进入审计。
                  if (request.getRequestURI().startsWith("/api/")
                      && (!"GET".equals(request.getMethod())
                          || request.getRequestURI().endsWith("/export"))) {
                    AuditLog auditLog = new AuditLog();
                    auditLog.setUsername(
                        request.getAttribute("audit.username") instanceof String loginName
                            ? loginName
                            : username);
                    auditLog.setMethod(request.getMethod());
                    auditLog.setPath(
                        request
                            .getRequestURI()
                            .substring(0, Math.min(request.getRequestURI().length(), 255)));
                    auditLog.setIp(request.getRemoteAddr());
                    auditLog.setStatus(response.getStatus());
                    auditLog.setDurationMs((System.nanoTime() - start) / 1000000);
                    audits.save(auditLog);
                  }
                }
              }
            },
            UsernamePasswordAuthenticationFilter.class)
        .build();
  }

  /** 过滤器尚未进入 MVC 时返回固定、已脱敏的认证失败消息，不输出异常或会话凭证。 */
  private static void json(HttpServletResponse response, int status, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"success\":false,\"data\":null,\"message\":\"" + message + "\"}");
  }
}
