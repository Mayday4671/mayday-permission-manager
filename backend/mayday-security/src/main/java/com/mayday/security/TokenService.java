package com.mayday.security;

import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Instant;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 256 位随机不透明令牌，无需把权限或个人信息放进浏览器可解码的 JWT。 */
@Service
@RequiredArgsConstructor
public class TokenService {
  private final SessionRepository sessions;
  private final UserRepository users;

  public static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(ex);
    }
  }

  @Transactional
  public String issue(SysUser user, String ip, String device) {
    sessions.deleteByExpiresAtBefore(Instant.now());
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    LoginSession session = new LoginSession();
    session.setSessionId(UUID.randomUUID().toString());
    session.setCreatedAt(Instant.now());
    session.setLastActiveAt(Instant.now());
    session.setIp(ip);
    session.setDevice(device == null ? "" : device.substring(0, Math.min(device.length(), 255)));
    session.setTokenHash(hash(token));
    session.setUserId(user.getId());
    session.setExpiresAt(Instant.now().plusSeconds(43200));
    sessions.save(session);
    return token;
  }

  @Transactional
  public Optional<SysUser> authenticate(String token) {
    if (token.length() > 128) return Optional.empty();
    return sessions
        .findById(hash(token))
        .filter(s -> s.getExpiresAt().isAfter(Instant.now()))
        .flatMap(
            s -> {
              if (s.getLastActiveAt() == null
                  || s.getLastActiveAt().isBefore(Instant.now().minusSeconds(60)))
                s.setLastActiveAt(Instant.now());
              return users.findById(s.getUserId());
            })
        .filter(SysUser::isEnabled);
  }

  @Transactional
  public void revoke(String token) {
    sessions.deleteById(hash(token));
  }

  @Transactional
  public void revokeUser(Long id) {
    sessions.deleteByUserId(id);
  }
}
