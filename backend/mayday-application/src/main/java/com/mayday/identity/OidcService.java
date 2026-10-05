package com.mayday.identity;

import com.mayday.common.BusinessException;
import com.mayday.security.JdbcSecurityState;
import com.mayday.security.TokenService;
import com.mayday.service.ChangeAuditService;
import com.mayday.system.repository.UserRepository;
import com.mayday.web.Contracts.LoginView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** OIDC 仅证明已显式绑定的外部身份；所有角色、数据范围和停用规则仍由本地账号决定。 */
@Service
@RequiredArgsConstructor
public class OidcService {
  private final IdentityProperties properties;
  private final IdentitySecrets secrets;
  private final IdentityStore challenges;
  private final OidcClient client;
  private final MfaService mfa;
  private final TokenService tokens;
  private final UserRepository users;
  private final JdbcTemplate jdbc;
  private final JdbcSecurityState rates;
  private final Clock sessionClock;
  private final PlatformTransactionManager transactions;
  private final ChangeAuditService changeAudit;
  private final JsonMapper json = JsonMapper.builder().build();

  /** 浏览器只收到公开名称和固定标识；客户端密钥、内部端点和账号映射从不进入匿名配置。 */
  public record ProviderView(String id, String name) {}

  /** HttpOnly cookie 值只交给控制器写响应，公开 DTO 只返回授权 URL。 */
  public record Start(String authorizationUrl, String browserCookie) {}

  /** 回调结果只返回本地会话/二次验证挑战或绑定完成标志，不能把企业 access token 当成本地会话。 */
  public record Completion(boolean bound, LoginView login) {}

  /** 个人中心的绑定记录不返回企业 subject/email，解绑依据随机 id 和当前本地身份。 */
  public record Binding(
      String id, String providerId, String providerName, String createdAt, String lastLoginAt) {}

  /** nonce/PKCE 与注册配置指纹只在加密挑战里保存，不能由回调重新指定。 */
  private record Pending(String providerId, String fingerprint, String nonce, String verifier) {}

  /** 只公布启用的固定登录选择，不允许匿名用户探测本地是否存在匹配企业账号。 */
  public List<ProviderView> providers() {
    return properties.getProviders().stream()
        .filter(IdentityProperties.Provider::isEnabled)
        .map(provider -> new ProviderView(provider.getId(), provider.getName()))
        .toList();
  }

  /** 本人绑定前必须近期密码/MFA 再认证；首次匿名登录没有自动创建或管理员邮箱匹配路径。 */
  public Start begin(
      String providerId,
      boolean binding,
      Long userId,
      String password,
      String factor,
      String session,
      String ip) {
    var provider = properties.provider(providerId);
    rates.reserve("oidc-start", ip, 30, 60000);
    String credentialHash = null;
    if (binding) {
      if (userId == null || session == null) throw new BusinessException("请先使用本地账号登录后绑定企业身份");
      var user = mfa.reauthenticate(userId, password, factor, ip);
      credentialHash = TokenService.hash(user.getPasswordHash());
      if (jdbc.queryForObject(
              "select count(*) from sys_external_identity where user_id=? and provider_id=?",
              Long.class,
              userId,
              providerId)
          > 0) throw new BusinessException("当前账号已绑定此企业登录方式，请先解除旧绑定");
    }
    String browser = IdentityStore.random(),
        nonce = IdentityStore.random(),
        verifier = IdentityStore.random();
    var pending = new Pending(providerId, fingerprint(provider), nonce, verifier);
    String state =
        challenges.create(
            binding ? "OIDC_BIND" : "OIDC_LOGIN",
            binding ? userId : null,
            ip,
            browser,
            binding ? session : null,
            credentialHash,
            null,
            secrets.encrypt(json.writeValueAsString(pending), "oidc"));
    return new Start(client.authorization(provider, state, nonce, verifier), browser);
  }

  /** state/cookie/来源证明成功后先永久消费，再进行外部请求；网络失败不允许同一 code 二次交换。 */
  public Completion complete(
      String state, String code, String browser, String bearer, String ip, String device) {
    IdentityStore.Challenge challenge;
    try {
      challenge = challenges.read(state, "OIDC_LOGIN", ip);
    } catch (BusinessException invalid) {
      challenge = challenges.read(state, "OIDC_BIND", ip);
    }
    if (browser == null || !constant(challenge.browserHash(), TokenService.hash(browser)))
      throw rejected();
    boolean binding = "OIDC_BIND".equals(challenge.purpose());
    Long expectedUser = challenge.userId();
    if (binding
        && (bearer == null
            || !constant(challenge.sessionHash(), TokenService.hash(bearer))
            || tokens
                .authenticate(bearer)
                .filter(user -> user.getId().equals(expectedUser))
                .isEmpty())) throw rejected();
    Pending pending =
        json.readValue(secrets.decrypt(challenge.payloadCipher(), "oidc"), Pending.class);
    var provider = properties.provider(pending.providerId());
    if (!constant(pending.fingerprint(), fingerprint(provider))) throw rejected();
    challenges.consumeBeforeExchange(challenge);
    String subject = client.exchange(provider, code, pending.nonce(), pending.verifier());
    var finalChallenge = challenge;
    return new TransactionTemplate(transactions)
        .execute(
            status -> {
              String issuerHash = TokenService.hash(provider.getIssuer()),
                  subjectHash = TokenService.hash(subject);
              if (binding) {
                var account =
                    users
                        .lockById(finalChallenge.userId())
                        .filter(com.mayday.system.model.SysUser::isEnabled)
                        .orElseThrow(OidcService::rejected);
                if (!TokenService.hash(account.getPasswordHash())
                        .equals(finalChallenge.credentialHash())
                    || tokens
                        .authenticate(bearer)
                        .filter(user -> user.getId().equals(account.getId()))
                        .isEmpty()) throw rejected();
                jdbc.update(
                    "insert into sys_external_identity(id,user_id,provider_id,issuer_hash,subject_hash,created_at) values(?,?,?,?,?,?)",
                    UUID.randomUUID().toString(),
                    account.getId(),
                    provider.getId(),
                    issuerHash,
                    subjectHash,
                    Timestamp.from(sessionClock.instant()));
                changeAudit.record(
                    "用户",
                    account.getId(),
                    "绑定企业登录",
                    Map.of("企业登录", "未绑定"),
                    Map.of("企业登录", provider.getName()));
                return new Completion(true, null);
              }
              var matches =
                  jdbc.queryForList(
                      "select id,user_id from sys_external_identity where provider_id=? and issuer_hash=? and subject_hash=?",
                      provider.getId(),
                      issuerHash,
                      subjectHash);
              if (matches.isEmpty()) throw new BusinessException("此企业身份尚未绑定本地账号，请先用本地账号登录并在个人中心绑定");
              Map<String, Object> match = matches.getFirst();
              var account =
                  users
                      .lockById(((Number) match.get("user_id")).longValue())
                      .filter(com.mayday.system.model.SysUser::isEnabled)
                      .orElseThrow(OidcService::rejected);
              // 先锁账号，再用当前读核对映射；RR 下普通读取会继续看到等锁前的旧快照。
              // 与解绑保持账号 → 映射的锁顺序，不能把首次定位映射改为先取映射锁。
              if (jdbc.queryForList(
                          "select id from sys_external_identity where id=? and user_id=? for update",
                          match.get("id"),
                          account.getId())
                      .size()
                  != 1) throw rejected();
              var login = mfa.loginAfterPrimary(account, ip, device, (String) match.get("id"));
              if (!login.mfaRequired())
                jdbc.update(
                    "update sys_external_identity set last_login_at=? where id=?",
                    Timestamp.from(sessionClock.instant()),
                    match.get("id"));
              return new Completion(false, login);
            });
  }

  /** 绑定摘要限定为当前用户；禁用/删除提供方也能解除旧绑定，不依赖外部服务在线。 */
  public List<Binding> bindings(Long userId) {
    return jdbc.query(
        "select id,provider_id,created_at,last_login_at from sys_external_identity where user_id=? order by created_at desc",
        (row, index) -> {
          String id = row.getString("provider_id");
          String name =
              properties.getProviders().stream()
                  .filter(provider -> provider.getId().equals(id))
                  .map(IdentityProperties.Provider::getName)
                  .findFirst()
                  .orElse(id);
          var last = row.getTimestamp("last_login_at");
          return new Binding(
              row.getString("id"),
              id,
              name,
              row.getTimestamp("created_at").toInstant().toString(),
              last == null ? null : last.toInstant().toString());
        },
        userId);
  }

  /** 本地密码是最后登录通道的明确证明；解绑后撤销所有会话，不能拿已有企业会话绕过密码/MFA。 */
  @org.springframework.transaction.annotation.Transactional
  public void unbind(Long userId, String id, String password, String factor, String ip) {
    mfa.reauthenticate(userId, password, factor, ip);
    var binding =
        jdbc.queryForList(
            "select provider_id from sys_external_identity where id=? and user_id=?", id, userId);
    if (binding.isEmpty()) throw new BusinessException("绑定不存在或已解除");
    if (jdbc.update("delete from sys_external_identity where id=? and user_id=?", id, userId) != 1)
      throw new BusinessException("绑定不存在或已解除");
    changeAudit.record(
        "用户",
        userId,
        "解除企业登录",
        Map.of("企业登录", (String) binding.getFirst().get("provider_id")),
        Map.of("企业登录", "已解除"));
    tokens.revokeUser(userId);
  }

  private String fingerprint(IdentityProperties.Provider provider) {
    return TokenService.hash(
        String.join(
            "\n",
            provider.getId(),
            provider.getIssuer(),
            provider.getClientId(),
            provider.getAuthorizationUri(),
            provider.getTokenUri(),
            provider.getJwksUri(),
            provider.getRedirectUri(),
            provider.getClientAuthentication(),
            TokenService.hash(provider.getClientSecret())));
  }

  private static boolean constant(String expected, String actual) {
    return expected != null
        && actual != null
        && MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
  }

  private static BusinessException rejected() {
    return new BusinessException("企业身份验证已过期或不匹配，请重新开始");
  }
}
