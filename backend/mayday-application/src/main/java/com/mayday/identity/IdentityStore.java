package com.mayday.identity;

import com.mayday.common.BusinessException;
import com.mayday.security.TokenService;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 身份挑战只存摘要与加密材料；独立短事务保存失败计数和一次性消费，网络请求不占行锁。 */
@Component
public class IdentityStore {
  private final JdbcTemplate jdbc;
  private final Clock clock;
  private final TransactionTemplate isolated;

  public IdentityStore(
      JdbcTemplate jdbc, Clock sessionClock, PlatformTransactionManager transactions) {
    this.jdbc = jdbc;
    this.clock = sessionClock;
    isolated = new TransactionTemplate(transactions);
    isolated.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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
    if (!List.of("MFA_LOGIN", "MFA_ENROLL", "OIDC_LOGIN", "OIDC_BIND").contains(purpose))
      throw new IllegalArgumentException("身份挑战用途不受支持");
    String token = random();
    Instant now = clock.instant();
    jdbc.update(
        "delete from sys_identity_challenge where expires_at < ? limit 1000",
        Timestamp.from(now.minusSeconds(86400)));
    jdbc.update(
        "insert into sys_identity_challenge(token_hash,purpose,user_id,source_hash,browser_hash,session_hash,credential_hash,credential_revision,payload_cipher,expires_at,created_at) values(?,?,?,?,?,?,?,?,?,?,?)",
        TokenService.hash(token),
        purpose,
        userId,
        TokenService.hash(source),
        digest(browser),
        digest(session),
        credentialHash,
        credentialRevision,
        payloadCipher,
        Timestamp.from(now.plusSeconds(300)),
        Timestamp.from(now));
    return token;
  }

  /** 载入尚未消费的挑战；格式、用途、到期、来源错误统一拒绝，避免匿名枚举本地账号。 */
  public Challenge read(String token, String purpose, String source) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalid();
    return jdbc
        .query(
            "select * from sys_identity_challenge where token_hash=?",
            this::map,
            TokenService.hash(token))
        .stream()
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
    if (jdbc.update(
            "update sys_identity_challenge set consumed_at=? where token_hash=? and consumed_at is null and failed_attempts<5 and expires_at>?",
            Timestamp.from(clock.instant()),
            challenge.hash,
            Timestamp.from(clock.instant()))
        != 1) throw invalid();
  }

  /** OIDC code 交换前消费并独立提交；外部网络失败不能让同一 state/code 再次进入交换。 */
  public void consumeBeforeExchange(Challenge challenge) {
    isolated.executeWithoutResult(status -> consume(challenge));
  }

  /** 失败证明不因上层业务异常回滚计数；第 5 次失败后旧挑战不能继续猜测。 */
  public void failed(Challenge challenge) {
    isolated.executeWithoutResult(
        status ->
            jdbc.update(
                "update sys_identity_challenge set failed_attempts=least(failed_attempts+1,5) where token_hash=? and consumed_at is null",
                challenge.hash));
  }

  /** 256 位随机 URL 安全凭证；用于挑战、浏览器关联和 PKCE，不作长期业务标识。 */
  public static String random() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private Challenge map(ResultSet row, int index) throws SQLException {
    Number userId = (Number) row.getObject("user_id");
    Timestamp consumed = row.getTimestamp("consumed_at");
    return new Challenge(
        row.getString("token_hash"),
        row.getString("purpose"),
        userId == null ? null : userId.longValue(),
        row.getString("source_hash"),
        row.getString("browser_hash"),
        row.getString("session_hash"),
        row.getString("credential_hash"),
        row.getString("credential_revision"),
        row.getString("payload_cipher"),
        row.getTimestamp("expires_at").toInstant(),
        consumed == null ? null : consumed.toInstant(),
        row.getInt("failed_attempts"));
  }

  private static String digest(String value) {
    return value == null ? null : TokenService.hash(value);
  }

  private static BusinessException invalid() {
    return new BusinessException("身份验证已过期或无效，请重新开始");
  }
}
