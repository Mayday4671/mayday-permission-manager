package com.mayday.security;

import com.mayday.system.model.LoginSession;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.SessionRepository;
import com.mayday.system.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 256 位随机不透明令牌，无需把权限或个人信息放进浏览器可解码的 JWT。 */
@Service
@RequiredArgsConstructor
public class TokenService {
  private final SessionRepository sessions;
  private final UserRepository users;
  private final SessionPolicy policy;
  private final Clock sessionClock;

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

  /**
   * 密码与滑块校验通过后创建配置期限的会话；按账号→会话锁序串行判断配额，撤销最早有效登录。 使用已提交读取，避免其他账号首登时的空范围间隙锁；外层 MFA/OIDC
   * 登录事务也使用同一隔离级别。 再次检查有效账号及密码摘要，拒绝密码验证后发生的重置/停用；原令牌仅在本次响应返回。
   */
  @Transactional(isolation = Isolation.READ_COMMITTED)
  public String issue(SysUser user, String ip, String device) {
    SysUser current =
        users.lockById(user.getId()).orElseThrow(() -> new AccessDeniedException("账号已失效，请重新登录"));
    if (!current.isEnabled() || !current.getPasswordHash().equals(user.getPasswordHash()))
      throw new AccessDeniedException("账号凭据已变更，请重新登录");
    // 锁等待可能持续到其他登录提交之后，取锁成功后的时间，保证配额淘汰顺序反映实际签发顺序。
    Instant now = sessionClock.instant();
    var previous = sessions.findByUserIdOrderByCreatedAtAscTokenHashAsc(current.getId());
    var active = previous.stream().filter(s -> policy.active(s, now)).toList();
    sessions.deleteAll(previous.stream().filter(s -> !policy.active(s, now)).toList());
    int revoke = Math.max(0, active.size() - policy.getMaxPerUser() + 1);
    sessions.deleteAll(active.subList(0, revoke));
    sessions.flush();
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    LoginSession session = new LoginSession();
    session.setSessionId(UUID.randomUUID().toString());
    session.setCreatedAt(now);
    session.setLastActiveAt(now);
    session.setIp(ip);
    session.setDevice(device == null ? "" : device.substring(0, Math.min(device.length(), 255)));
    session.setTokenHash(hash(token));
    session.setUserId(current.getId());
    session.setExpiresAt(now.plusSeconds(policy.getAbsoluteMinutes() * 60L));
    sessions.save(session);
    return token;
  }

  /** 每次请求重新读取会话和有效账号，及时生效撤销、停用和角色变更；活跃时间最多每分钟写一次。 */
  @Transactional
  public Optional<SysUser> authenticate(String token) {
    if (token.length() > 128) return Optional.empty();
    Instant now = sessionClock.instant();
    return sessions
        .findById(hash(token))
        .filter(session -> policy.active(session, now))
        .flatMap(
            session -> {
              if (session.getLastActiveAt() == null
                  || !session.getLastActiveAt().isAfter(now.minusSeconds(60)))
                session.setLastActiveAt(now);
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
