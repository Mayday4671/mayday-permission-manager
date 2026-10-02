package com.mayday.security;

import com.mayday.common.ModuleSwitches;
import com.mayday.system.model.AuditLog;
import com.mayday.system.repository.AuditRepository;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
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

  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  /** 明确关闭框架生成的默认演示用户，本平台只接受数据库会话认证。 */
  @Bean
  org.springframework.security.core.userdetails.UserDetailsService userDetailsService() {
    return username -> {
      throw new org.springframework.security.core.userdetails.UsernameNotFoundException("使用会话令牌认证");
    };
  }

  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http.csrf(c -> c.disable())
        .cors(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers(
                        "/api/auth/login",
                        "/api/auth/captcha/challenge",
                        "/api/auth/captcha/verify",
                        "/api/platform/features",
                        "/api/public/**",
                        "/actuator/health",
                        "/error")
                    .permitAll()
                    .requestMatchers("/api/platform/openapi", "/api/platform/openapi/**")
                    .access(
                        (authentication, context) ->
                            new org.springframework.security.authorization.AuthorizationDecision(
                                authentication.get().getPrincipal()
                                        instanceof com.mayday.system.model.SysUser user
                                    && user.getRoles().stream()
                                        .anyMatch(
                                            role ->
                                                role.isEnabled()
                                                    && "admin".equals(role.getCode()))))
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint((req, res, ex) -> json(res, 401, "请先登录或重新登录"))
                    .accessDeniedHandler((req, res, ex) -> json(res, 403, "没有此操作的权限")))
        .addFilterBefore(
            new OncePerRequestFilter() {
              @Override
              protected void doFilterInternal(
                  HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                  throws ServletException, IOException {
                long start = System.nanoTime();
                // 在认证与业务控制器之前阻断关闭模块，包括管理员、附件及猜测 ID 的直接请求。
                if (!modules.pathEnabled(req.getServletPath())) {
                  json(res, 404, "该功能未启用");
                  return;
                }
                String auth = req.getHeader("Authorization");
                if (auth != null && auth.startsWith("Bearer "))
                  tokens
                      .authenticate(auth.substring(7))
                      .ifPresent(
                          user ->
                              SecurityContextHolder.getContext()
                                  .setAuthentication(
                                      new UsernamePasswordAuthenticationToken(
                                          user, null, List.of())));
                String username =
                    SecurityContextHolder.getContext().getAuthentication() == null
                        ? "anonymous"
                        : ((com.mayday.system.model.SysUser)
                                SecurityContextHolder.getContext()
                                    .getAuthentication()
                                    .getPrincipal())
                            .getUsername();
                try {
                  chain.doFilter(req, res);
                } finally {
                  // 不记录请求体、Authorization 头及查询参数；失败请求同样进入审计。
                  if (req.getRequestURI().startsWith("/api/")
                      && (!"GET".equals(req.getMethod())
                          || req.getRequestURI().endsWith("/export"))) {
                    AuditLog log = new AuditLog();
                    log.setUsername(
                        req.getAttribute("audit.username") instanceof String loginName
                            ? loginName
                            : username);
                    log.setMethod(req.getMethod());
                    log.setPath(
                        req.getRequestURI()
                            .substring(0, Math.min(req.getRequestURI().length(), 255)));
                    log.setIp(req.getRemoteAddr());
                    log.setStatus(res.getStatus());
                    log.setDurationMs((System.nanoTime() - start) / 1000000);
                    audits.save(log);
                  }
                }
              }
            },
            UsernamePasswordAuthenticationFilter.class)
        .build();
  }

  private static void json(HttpServletResponse response, int status, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"success\":false,\"data\":null,\"message\":\"" + message + "\"}");
  }
}
