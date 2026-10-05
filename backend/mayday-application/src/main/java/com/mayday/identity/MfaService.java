package com.mayday.identity;

import com.mayday.common.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.security.LoginThrottle;
import com.mayday.security.TokenService;
import com.mayday.security.Totp;
import com.mayday.service.ChangeAuditService;
import com.mayday.service.UserService;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.LoginView;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 账号行锁串行化开通/关闭/登录；TOTP、恢复码和挑战在同一事务消费，任何失败都不能签发会话。 */
@Service
@RequiredArgsConstructor
public class MfaService {
  private final IdentityProperties properties;
  private final IdentitySecrets secrets;
  private final IdentityStore challenges;
  private final JdbcTemplate jdbc;
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final TokenService tokens;
  private final LoginThrottle throttle;
  private final Clock sessionClock;
  private final AccessPolicy access;
  private final UserService userService;
  private final ChangeAuditService changeAudit;

  /** 个人中心只显示启用状态与剩余恢复码数；不返回已保存的共享密钥或散列。 */
  public record Status(boolean available, boolean enabled, long recoveryCodesRemaining) {}

  /** 待开通密钥仅此次返回供认证器扫码，必须再提交真实验证码才成为已开通凭据。 */
  public record Enrollment(String challengeId, String secret, String provisioningUri) {}

  /** 当前账号的多因素摘要；部署关闭开通不绕过已开通账号的登录验证。 */
  public Status status(Long userId) {
    return new Status(
        properties.isMfaEnabled(),
        jdbc.queryForObject(
                "select count(*) from sys_mfa_credential where user_id=?", Long.class, userId)
            > 0,
        jdbc.queryForObject(
            "select count(*) from sys_mfa_recovery where user_id=? and used_at is null",
            Long.class,
            userId));
  }

  /** 首因素通过后重新持有账号锁；只有没有 MFA 的账号才直接签发会话。 */
  @Transactional
  public LoginView loginAfterPrimary(SysUser verified, String ip, String device) {
    return loginAfterPrimary(verified, ip, device, null);
  }

  /** 企业首因素建立的挑战同时绑定当前映射；解绑或禁用提供方后旧二次验证不能继续登录。 */
  @Transactional
  public LoginView loginAfterPrimary(
      SysUser verified, String ip, String device, String externalBindingId) {
    SysUser account = current(verified.getId());
    if (!account.getPasswordHash().equals(verified.getPasswordHash())) throw invalid();
    Map<String, Object> credential = credential(account.getId());
    if (credential == null) return new LoginView(tokens.issue(account, ip, device));
    requireAllowed(account.getId(), ip);
    String challenge =
        challenges.create(
            "MFA_LOGIN",
            account.getId(),
            ip,
            null,
            null,
            TokenService.hash(account.getPasswordHash()),
            string(credential, "revision"),
            externalBindingId == null
                ? null
                : secrets.encrypt(externalBindingId, "mfa-binding:" + account.getId()));
    return new LoginView(null, true, challenge);
  }

  /** MFA 登录再次核对密码代际、账号状态和 MFA 代际；旧挑战/OTP/恢复码不能产生第二次登录。 */
  @Transactional
  public LoginView completeLogin(String challengeId, String factor, String ip, String device) {
    var challenge = challenges.read(challengeId, "MFA_LOGIN", ip);
    SysUser account = current(challenge.userId());
    Map<String, Object> credential = credential(account.getId());
    if (credential == null
        || !TokenService.hash(account.getPasswordHash()).equals(challenge.credentialHash())
        || !string(credential, "revision").equals(challenge.credentialRevision())) throw invalid();
    String externalBindingId = null;
    if (challenge.payloadCipher() != null) {
      externalBindingId =
          secrets.decrypt(challenge.payloadCipher(), "mfa-binding:" + account.getId());
      var binding =
          jdbc.queryForList(
              "select provider_id,issuer_hash from sys_external_identity where id=? and user_id=? for update",
              externalBindingId,
              account.getId());
      if (binding.isEmpty()) throw invalid();
      var provider = properties.provider(string(binding.getFirst(), "provider_id"));
      if (!TokenService.hash(provider.getIssuer())
          .equals(string(binding.getFirst(), "issuer_hash"))) throw invalid();
    }
    try {
      requireAllowed(account.getId(), ip);
      verifyFactor(account.getId(), factor, credential);
    } catch (BusinessException invalid) {
      challenges.failed(challenge);
      failed(account.getId(), ip);
      throw invalid;
    }
    challenges.consume(challenge);
    succeeded(account.getId(), ip);
    if (externalBindingId != null)
      jdbc.update(
          "update sys_external_identity set last_login_at=? where id=?",
          Timestamp.from(sessionClock.instant()),
          externalBindingId);
    return new LoginView(tokens.issue(account, ip, device));
  }

  /** 近期本地再认证用于开通/恢复码/解绑等敏感动作，不以会话存在代替密码和已启用 MFA。 */
  @Transactional
  public SysUser reauthenticate(Long userId, String password, String factor, String ip) {
    SysUser account = current(userId);
    requireAllowed(userId, ip);
    if (password == null
        || password.getBytes(StandardCharsets.UTF_8).length > 72
        || !encoder.matches(password, account.getPasswordHash())) {
      failed(userId, ip);
      throw new BusinessException("当前密码或身份验证码不正确");
    }
    var credential = credential(userId);
    if (credential != null) {
      try {
        verifyFactor(userId, factor, credential);
      } catch (BusinessException error) {
        failed(userId, ip);
        throw error;
      }
    }
    succeeded(userId, ip);
    return account;
  }

  /** 开通只允许当前未启用账号；待确认秘密有独立短期挑战，重开弹窗不会保存为启用状态。 */
  @Transactional
  public Enrollment enroll(Long userId, String password, String ip) {
    if (!properties.isMfaEnabled()) throw new BusinessException("多因素认证开通未启用，请联系管理员配置");
    SysUser account = reauthenticate(userId, password, null, ip);
    if (credential(userId) != null) throw new BusinessException("多因素认证已开通，不能重复开通");
    String secret = Totp.newSecret();
    String challenge =
        challenges.create(
            "MFA_ENROLL",
            userId,
            ip,
            null,
            null,
            TokenService.hash(account.getPasswordHash()),
            null,
            secrets.encrypt(secret, "mfa-enroll:" + userId));
    String label = encode(properties.getIssuerLabel() + ":" + account.getUsername());
    String uri =
        "otpauth://totp/"
            + label
            + "?secret="
            + secret
            + "&issuer="
            + encode(properties.getIssuerLabel())
            + "&algorithm=SHA1&digits=6&period=30";
    return new Enrollment(challenge, secret, uri);
  }

  /** 确認时校验挑战归属、密码代际及验证码；密钥入库后撤销旧会话，恢复码只返回一次。 */
  @Transactional
  public List<String> confirm(Long userId, String challengeId, String factor, String ip) {
    var challenge = challenges.read(challengeId, "MFA_ENROLL", ip);
    SysUser account = current(userId);
    if (!userId.equals(challenge.userId())
        || !TokenService.hash(account.getPasswordHash()).equals(challenge.credentialHash())
        || credential(userId) != null) throw invalid();
    requireAllowed(userId, ip);
    String secret = secrets.decrypt(challenge.payloadCipher(), "mfa-enroll:" + userId);
    long step = Totp.verify(secret, factor, sessionClock.instant(), -1);
    if (step < 0) {
      challenges.failed(challenge);
      failed(userId, ip);
      throw new BusinessException("身份验证码不正确或已使用");
    }
    challenges.consume(challenge);
    succeeded(userId, ip);
    String revision = UUID.randomUUID().toString();
    jdbc.update(
        "insert into sys_mfa_credential(user_id,secret_cipher,revision,last_step,created_at) values(?,?,?,?,?)",
        userId,
        secrets.encrypt(secret, "mfa:" + userId),
        revision,
        step,
        Timestamp.from(sessionClock.instant()));
    var codes = newRecovery(userId, revision);
    tokens.revokeUser(userId);
    changeAudit.record("用户", userId, "开通多因素认证", Map.of("MFA", "未开通"), Map.of("MFA", "已开通"));
    return codes;
  }

  /** 重新生成恢复码必须密码加现有因素，两组恢复码不能并存；旧会话撤销避免遗留低保障登录。 */
  @Transactional
  public List<String> regenerate(Long userId, String password, String factor, String ip) {
    reauthenticate(userId, password, factor, ip);
    var credential = credential(userId);
    if (credential == null) throw new BusinessException("尚未开通多因素认证");
    var result = newRecovery(userId, string(credential, "revision"));
    tokens.revokeUser(userId);
    changeAudit.record("用户", userId, "重新生成恢复码", Map.of("恢复码", "旧组"), Map.of("恢复码", "已轮换"));
    return result;
  }

  /** 关闭需要密码加可用 TOTP/恢复码；不允许通过修改前端 enabled 标记或删除本地缓存关闭。 */
  @Transactional
  public void disable(Long userId, String password, String factor, String ip) {
    reauthenticate(userId, password, factor, ip);
    if (credential(userId) == null) throw new BusinessException("尚未开通多因素认证");
    jdbc.update("delete from sys_mfa_recovery where user_id=?", userId);
    jdbc.update("delete from sys_mfa_credential where user_id=?", userId);
    jdbc.update("delete from sys_identity_challenge where user_id=?", userId);
    tokens.revokeUser(userId);
    changeAudit.record("用户", userId, "关闭多因素认证", Map.of("MFA", "已开通"), Map.of("MFA", "未开通"));
  }

  /** 遗失认证器及全部恢复码时，由具备账号重置权限的管理者经近期再认证在可管理范围内恢复。 */
  @Transactional
  public void administrativeReset(
      Long userId, String password, String factor, String reason, String ip) {
    access.require("users:view");
    access.require("users:reset");
    Long actorId = access.current().getId();
    // 按账号 ID 升序锁定双方，两个管理员互相恢复不会形成相反锁序；取锁后再检查目标当前角色和范围。
    for (Long id : java.util.stream.Stream.of(actorId, userId).distinct().sorted().toList())
      users.lockById(id).orElseThrow(MfaService::invalid);
    var actor = users.findById(actorId).filter(SysUser::isEnabled).orElseThrow(MfaService::invalid);
    if (!access.hasFor(actor, "users:view") || !access.hasFor(actor, "users:reset"))
      throw new org.springframework.security.access.AccessDeniedException("没有此操作的权限");
    userService.manageable(userId);
    reauthenticate(access.current().getId(), password, factor, ip);
    if (credential(userId) == null) throw new BusinessException("该账号尚未开通多因素认证");
    jdbc.update("delete from sys_mfa_recovery where user_id=?", userId);
    jdbc.update("delete from sys_mfa_credential where user_id=?", userId);
    jdbc.update("delete from sys_identity_challenge where user_id=?", userId);
    tokens.revokeUser(userId);
    changeAudit.record(
        "用户",
        userId,
        "管理员恢复多因素认证",
        Map.of("MFA", "已开通"),
        Map.of("MFA", "已关闭，需重新开通", "理由", reason.strip()));
  }

  private List<String> newRecovery(Long userId, String revision) {
    jdbc.update("delete from sys_mfa_recovery where user_id=?", userId);
    var result = new ArrayList<String>();
    for (int index = 0; index < 10; index++) {
      byte[] bytes = new byte[16];
      new java.security.SecureRandom().nextBytes(bytes);
      String code = java.util.HexFormat.of().formatHex(bytes).toUpperCase(java.util.Locale.ROOT);
      String formatted =
          code.substring(0, 8)
              + "-"
              + code.substring(8, 16)
              + "-"
              + code.substring(16, 24)
              + "-"
              + code.substring(24);
      jdbc.update(
          "insert into sys_mfa_recovery(code_hash,user_id,credential_revision) values(?,?,?)",
          TokenService.hash(code),
          userId,
          revision);
      result.add(formatted);
    }
    return result;
  }

  private void verifyFactor(Long userId, String factor, Map<String, Object> credential) {
    String normalized =
        factor == null ? "" : factor.trim().replace("-", "").toUpperCase(java.util.Locale.ROOT);
    if (normalized.matches("[A-F0-9]{32}")) {
      if (jdbc.update(
              "update sys_mfa_recovery set used_at=? where code_hash=? and user_id=? and credential_revision=? and used_at is null",
              Timestamp.from(sessionClock.instant()),
              TokenService.hash(normalized),
              userId,
              string(credential, "revision"))
          == 1) return;
    } else {
      long step =
          Totp.verify(
              secrets.decrypt(string(credential, "secret_cipher"), "mfa:" + userId),
              normalized,
              sessionClock.instant(),
              ((Number) credential.get("last_step")).longValue());
      if (step >= 0
          && jdbc.update(
                  "update sys_mfa_credential set last_step=? where user_id=? and last_step<?",
                  step,
                  userId,
                  step)
              == 1) return;
    }
    throw new BusinessException("身份验证码不正确或已使用");
  }

  /** 所有凭据证明调用方先持有账号锁；当前读拒绝等锁期间刚启用/撤销后的旧快照。状态摘要独立使用无锁 count。 */
  private Map<String, Object> credential(Long userId) {
    return jdbc
        .queryForList(
            "select secret_cipher,revision,last_step from sys_mfa_credential where user_id=? for update",
            userId)
        .stream()
        .findFirst()
        .orElse(null);
  }

  private SysUser current(Long userId) {
    return users.lockById(userId).filter(SysUser::isEnabled).orElseThrow(MfaService::invalid);
  }

  private void requireAllowed(Long userId, String ip) {
    if (!throttle.allowed("mfa:" + ip, userId.toString())
        || !throttle.allowed("mfa-user:" + userId, userId.toString()))
      throw new BusinessException("身份验证尝试过多，请 15 分钟后重试");
  }

  private void failed(Long userId, String ip) {
    throttle.failed("mfa:" + ip, userId.toString());
    throttle.failed("mfa-user:" + userId, userId.toString());
  }

  private void succeeded(Long userId, String ip) {
    throttle.succeeded("mfa:" + ip, userId.toString());
    throttle.succeeded("mfa-user:" + userId, userId.toString());
  }

  private static String string(Map<String, Object> row, String key) {
    return (String) row.get(key);
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private static BusinessException invalid() {
    return new BusinessException("身份验证已过期或无效，请重新开始");
  }
}
