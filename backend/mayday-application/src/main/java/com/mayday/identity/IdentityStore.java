package com.mayday.identity;

import com.mayday.common.exception.BusinessException;
import com.mayday.identity.mapper.IdentityChallengeMapper;
import com.mayday.security.TokenService;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 身份挑战只存摘要与加密材料；独立短事务保存失败计数和一次性消费，网络请求不占行锁。 */
@Component
public class IdentityStore {
  private final IdentityChallengeMapper challenges;
  private final Clock clock;
  private final TransactionTemplate isolated;

  public IdentityStore(
      IdentityChallengeMapper challenges,
      Clock sessionClock,
      PlatformTransactionManager transactions) {
    this.challenges = challenges;
    this.clock = sessionClock;
    isolated = new TransactionTemplate(transactions);
    isolated.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** 256 位随机 URL 安全凭证；用于挑战、浏览器关联和 PKCE，不作长期业务标识。 */
  public static String random() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static Instant toInstant(Object value) {
    if (value instanceof Instant instant) {
      return instant;
    }
    if (value instanceof java.time.LocalDateTime time) {
      return time.atZone(java.time.ZoneOffset.UTC).toInstant();
    }
    if (value instanceof Timestamp stamp) {
      return stamp.toInstant();
    }
    throw new IllegalStateException("不支持的时间列类型: " + value.getClass());
  }

  private static String digest(String value) {
    return value == null ? null : TokenService.hash(value);
  }

  private static BusinessException invalid() {
    return new BusinessException("身份验证已过期或无效，请重新开始");
  }

  /** 创建 5 分钟挑战；显式绑定已有密码/MFA/会话，来源只存摘要，过期记录分批清理。 */
  public String create(
      String purpose,
      Long userId,
      String source,
      String browser,
      String session,
      String credentialHash,
      String credentialRevision,
      String payloadCipher) {
    if (!List.of("MFA_LOGIN", "MFA_ENROLL", "OIDC_LOGIN", "OIDC_BIND").contains(purpose)) {
      throw new IllegalArgumentException("身份挑战用途不受支持");
    }
    String token = random();
    Instant now = clock.instant();
    challenges.purgeExpired(now.minusSeconds(86400));
    challenges.insert(
        new Challenge(
            TokenService.hash(token),
            purpose,
            userId,
            TokenService.hash(source),
            digest(browser),
            digest(session),
            credentialHash,
            credentialRevision,
            payloadCipher,
            now.plusSeconds(300),
            null,
            0),
        now);
    return token;
  }

  /** 载入尚未消费的挑战；格式、用途、到期、来源错误统一拒绝，避免匿名枚举本地账号。 */
  public Challenge read(String token, String purpose, String source) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) {
      throw invalid();
    }
    return challenges.find(TokenService.hash(token)).stream()
        .map(this::map)
        .filter(row -> row != null)
        .filter(
            row ->
                row.purpose.equals(purpose)
                    && row.consumedAt == null
                    && row.failedAttempts < 5
                    && row.expiresAt.isAfter(clock.instant())
                    && row.sourceHash.equals(TokenService.hash(source)))
        .findFirst()
        .orElseThrow(IdentityStore::invalid);
  }

  /** 正式证明成功后只允许一个调用消费；与外层业务事务一起提交，不能重复签发登录会话。 */
  public void consume(Challenge challenge) {
    if (challenges.consume(challenge.hash, clock.instant()) != 1) {
      throw invalid();
    }
  }

  /** OIDC code 交换前消费并独立提交；外部网络失败不能让同一 state/code 再次进入交换。 */
  public void consumeBeforeExchange(Challenge challenge) {
    isolated.executeWithoutResult(status -> consume(challenge));
  }

  /** 失败证明不因上层业务异常回滚计数；第 5 次失败后旧挑战不能继续猜测。 */
  public void failed(Challenge challenge) {
    isolated.executeWithoutResult(status -> challenges.fail(challenge.hash));
  }

  /** 行值到挑战快照；时间列由驱动以 java.time 类型返回，空值表示尚未消费。 */
  private Challenge map(com.mybatisflex.core.row.Row row) {
    Long userId = row.getLong("user_id");
    Object consumed = row.get("consumed_at");
    Object expires = row.get("expires_at");
    return new Challenge(
        row.getString("token_hash"),
        row.getString("purpose"),
        userId,
        row.getString("source_hash"),
        row.getString("browser_hash"),
        row.getString("session_hash"),
        row.getString("credential_hash"),
        row.getString("credential_revision"),
        row.getString("payload_cipher"),
        expires == null ? null : toInstant(expires),
        consumed == null ? null : toInstant(consumed),
        row.getInt("failed_attempts"));
  }

  /** 挑战的封闭状态；密码/MFA 代际和会话绑定只作服务端校验，不序列化到公开响应。 */
  public record Challenge(
      String hash,
      String purpose,
      Long userId,
      String sourceHash,
      String browserHash,
      String sessionHash,
      String credentialHash,
      String credentialRevision,
      String payloadCipher,
      Instant expiresAt,
      Instant consumedAt,
      int failedAttempts) {}
}
