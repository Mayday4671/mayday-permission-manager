package com.mayday.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** 登录限流行为测试：避免正常团队登录被误封，同时限制同一来源的密码猜测。 */
class LoginThrottleTest {
  @Test
  void locksAfterFiveFailedAttemptsAndKeepsOtherAccountsUsable() {
    LoginThrottle limiter = new LoginThrottle();
    for (int i = 0; i < 5; i++) {
      assertTrue(limiter.allowed("127.0.0.1", "member"));
      limiter.failed("127.0.0.1", "member");
    }
    assertFalse(limiter.allowed("127.0.0.1", "member"));
    assertFalse(limiter.allowed("127.0.0.1", "MEMBER"));
    assertTrue(limiter.allowed("127.0.0.1", "other"));
  }

  @Test
  void repeatedSuccessfulLoginsDoNotConsumeFailureBudget() {
    LoginThrottle limiter = new LoginThrottle();
    for (int i = 0; i < 120; i++) {
      assertTrue(limiter.allowed("127.0.0.1", "admin"));
      limiter.succeeded("127.0.0.1", "admin");
    }
  }

  @Test
  void sourceLimitBlocksRotatingUsernames() {
    LoginThrottle limiter = new LoginThrottle();
    for (int i = 0; i < 100; i++) limiter.failed("127.0.0.1", "user" + i);
    assertFalse(limiter.allowed("127.0.0.1", "next"));
    assertTrue(limiter.allowed("127.0.0.2", "next"));
  }
}
