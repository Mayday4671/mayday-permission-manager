package com.mayday.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import jakarta.servlet.ServletException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 检查失败请求也有随机定位号，客户端不能注入，异常和线程复用都不残留另一请求的MDC。 */
class RequestCorrelationFilterTest {
  @Test
  void suppliedIdentifierIsIgnoredAndContextIsCleared() throws Exception {
    var request = new MockHttpServletRequest();
    request.addHeader("X-Request-ID", "attacker-controlled");
    var response = new MockHttpServletResponse();
    new RequestCorrelationFilter()
        .doFilter(
            request,
            response,
            (req, res) -> {
              assertEquals(response.getHeader("X-Request-ID"), MDC.get("requestId"));
              res.getWriter().write("denied");
            });
    UUID.fromString(response.getHeader("X-Request-ID"));
    assertNotEquals("attacker-controlled", response.getHeader("X-Request-ID"));
    assertNull(MDC.get("requestId"));
  }

  @Test
  void failurePreservesHeaderAndRestoresPreviousThreadContext() {
    MDC.put("requestId", "outer-context");
    try {
      var response = new MockHttpServletResponse();
      assertThrows(
          ServletException.class,
          () ->
              new RequestCorrelationFilter()
                  .doFilter(
                      new MockHttpServletRequest(),
                      response,
                      (req, res) -> {
                        throw new ServletException("synthetic failure");
                      }));
      UUID.fromString(response.getHeader("X-Request-ID"));
      assertEquals("outer-context", MDC.get("requestId"));
    } finally {
      MDC.clear();
    }
  }
}
