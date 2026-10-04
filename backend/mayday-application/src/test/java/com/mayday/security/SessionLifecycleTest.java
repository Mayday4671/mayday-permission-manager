package com.mayday.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.system.model.LoginSession;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.SessionRepository;
import com.mayday.system.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.AccessDeniedException;

/** 验证期限边界、旧会话收紧、配额淘汰及凭据变化窗口；并发行锁另走真实MySQL/HTTP回归。 */
class SessionLifecycleTest {
  private static final Instant NOW = Instant.parse("2026-10-04T06:00:00Z");
  private final SessionPolicy policy = new SessionPolicy();
  private final SessionRepository sessions = mock(SessionRepository.class);
  private final UserRepository users = mock(UserRepository.class);
  private final TokenService tokens =
      new TokenService(sessions, users, policy, Clock.fixed(NOW, ZoneOffset.UTC));

  private LoginSession session(int ageMinutes, int idleMinutes) {
    var session = new LoginSession();
    session.setCreatedAt(NOW.minusSeconds(ageMinutes * 60L));
    session.setLastActiveAt(NOW.minusSeconds(idleMinutes * 60L));
    session.setExpiresAt(session.getCreatedAt().plusSeconds(720 * 60L));
    session.setUserId(1L);
    return session;
  }

  private SysUser user(String hash) {
    var user = new SysUser();
    user.setId(1L);
    user.setEnabled(true);
    user.setPasswordHash(hash);
    return user;
  }

  @Test
  void expiresAtIdleBoundaryBeforeTouchingActivity() {
    var expired = session(60, 30);
    when(sessions.findById(TokenService.hash("expired"))).thenReturn(Optional.of(expired));
    assertTrue(tokens.authenticate("expired").isEmpty());
    assertEquals(NOW.minusSeconds(1800), expired.getLastActiveAt());
    verify(users, never()).findById(any());
  }

  @Test
  void recentActivityDoesNotExtendAbsoluteLifetime() {
    assertFalse(policy.active(session(720, 1), NOW));
    assertTrue(policy.active(session(719, 1), NOW));
    var old = session(60, 1);
    policy.setAbsoluteMinutes(60);
    assertFalse(policy.active(old, NOW));
    policy.setAbsoluteMinutes(1440);
    assertFalse(policy.active(session(720, 1), NOW));
  }

  @Test
  void unknownCreationCannotReactivateAndNullActivityUsesCreation() {
    var valid = session(10, 1);
    valid.setLastActiveAt(null);
    assertTrue(policy.active(valid, NOW));
    valid.setCreatedAt(null);
    assertFalse(policy.active(valid, NOW));
  }

  @Test
  void validActivityIsRateLimitedAndPreservesAbsoluteExpiry() {
    var active = session(60, 2);
    Instant expiry = active.getExpiresAt();
    when(sessions.findById(TokenService.hash("active"))).thenReturn(Optional.of(active));
    when(users.findById(1L)).thenReturn(Optional.of(user("hash")));
    assertTrue(tokens.authenticate("active").isPresent());
    assertEquals(NOW, active.getLastActiveAt());
    assertEquals(expiry, active.getExpiresAt());
  }

  @Test
  void quotaRemovesExpiredAndOldestAndStoresOnlyDigest() {
    policy.setMaxPerUser(2);
    var older = session(10, 1);
    var newer = session(5, 1);
    var expired = session(90, 30);
    var account = user("hash");
    when(users.lockById(1L)).thenReturn(Optional.of(account));
    when(sessions.findByUserIdOrderByCreatedAtAscTokenHashAsc(1L))
        .thenReturn(List.of(expired, older, newer));
    String token = tokens.issue(account, "127.0.0.1", "test-device");
    verify(sessions).deleteAll(List.of(expired));
    verify(sessions).deleteAll(List.of(older));
    var saved = ArgumentCaptor.forClass(LoginSession.class);
    verify(sessions).save(saved.capture());
    assertEquals(TokenService.hash(token), saved.getValue().getTokenHash());
    assertFalse(token.equals(saved.getValue().getTokenHash()));
    assertEquals(NOW.plusSeconds(43200), saved.getValue().getExpiresAt());
  }

  @Test
  void passwordResetAndDisabledAccountBlockLateIssuance() {
    when(users.lockById(1L)).thenReturn(Optional.of(user("changed")));
    assertThrows(AccessDeniedException.class, () -> tokens.issue(user("old"), "127.0.0.1", "test"));
    var disabled = user("old");
    disabled.setEnabled(false);
    when(users.lockById(1L)).thenReturn(Optional.of(disabled));
    assertThrows(AccessDeniedException.class, () -> tokens.issue(user("old"), "127.0.0.1", "test"));
    verify(sessions, never()).save(any());
  }

  @Test
  void invalidPolicyCannotSilentlyDisableTimeoutOrQuota() {
    policy.setIdleMinutes(0);
    assertThrows(IllegalArgumentException.class, policy::afterPropertiesSet);
    policy.setIdleMinutes(721);
    assertThrows(IllegalArgumentException.class, policy::afterPropertiesSet);
    policy.setIdleMinutes(30);
    policy.setMaxPerUser(0);
    assertThrows(IllegalArgumentException.class, policy::afterPropertiesSet);
    policy.setMaxPerUser(21);
    assertThrows(IllegalArgumentException.class, policy::afterPropertiesSet);
  }
}
