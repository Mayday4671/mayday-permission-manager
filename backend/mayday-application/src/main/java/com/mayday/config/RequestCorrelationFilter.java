package com.mayday.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 每个请求生成独立随机定位号，401/403及业务故障均通过响应头关联服务端日志。 不采用客户端提供的定位号，避免伪造关联、超长输入和日志注入；标识不参与授权。
 * 线程退出时恢复原MDC，不能把前一用户的上下文带到线程池下一请求。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestCorrelationFilter extends OncePerRequestFilter {
  /** 包裹认证与MVC处理，只输出随机标识，不读取正文、查询参数或认证凭据。 */
  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String previous = MDC.get("requestId");
    String id = UUID.randomUUID().toString();
    response.setHeader("X-Request-ID", id);
    MDC.put("requestId", id);
    try {
      chain.doFilter(request, response);
    } finally {
      if (previous == null) MDC.remove("requestId");
      else MDC.put("requestId", previous);
    }
  }
}
