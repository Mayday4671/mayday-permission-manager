package com.mayday.security;

import com.mayday.system.model.LoginSession;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.SessionRepository;
import com.mayday.system.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 256 位随机不透明令牌，无需把权限或个人信息放进浏览器可解码的 JWT。 */
@Service
@RequiredArgsConstructor
public class TokenService {
  private final SessionRepository sessions;
  private final UserRepository users;

  /** 对不透明令牌计算数据库索引摘要；不用于密码散列，调用方不得把原令牌写入日志或公开 DTO。 */
  public static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }

  /** 密码与滑块校验通过后创建 12 小时会话；只把摘要落库，原令牌仅在本次登录响应返回。 */
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

  /** 每次请求重新读取会话和有效账号，及时生效撤销、停用和角色变更；活跃时间最多每分钟写一次。 */
  @Transactional
  public Optional<SysUser> authenticate(String token) {
    if (token.length() > 128) return Optional.empty();
    return sessions
        .findById(hash(token))
        .filter(session -> session.getExpiresAt().isAfter(Instant.now()))
        .flatMap(
            session -> {
              if (session.getLastActiveAt() == null
                  || session.getLastActiveAt().isBefore(Instant.now().minusSeconds(60)))
                session.setLastActiveAt(Instant.now());
              return users.findById(session.getUserId());
            })
        .filter(SysUser::isEnabled);
  }

  /** 按令牌摘要删除当前会话；已不存在时仍视作完成，调用方只能传入已认证请求持有的令牌。 */
  @Transactional
  public void revoke(String token) {
    sessions.deleteById(hash(token));
  }

  /** 密码变更、停用或管理下线时原子清除账号所有会话；跨账号调用必须先校验账号管理权限。 */
  @Transactional
  public void revokeUser(Long id) {
    sessions.deleteByUserId(id);
  }
}
