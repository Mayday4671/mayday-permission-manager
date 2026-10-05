package com.mayday.identity;

import com.mayday.common.BusinessException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** OIDC Authorization Code + PKCE S256；逐次校验签名和 iss/aud/azp/nonce/时间，不信任邮箱或角色声明。 */
@Component
public class OidcClient {
  private final Clock clock;
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();
  private final JsonMapper json = JsonMapper.builder().build();

  public OidcClient(Clock sessionClock) {
    clock = sessionClock;
  }

  /** 只构建预注册授权地址与固定回调；浏览器不能传入 redirect_uri、scope 或权限映射。 */
  public String authorization(
      IdentityProperties.Provider provider, String state, String nonce, String verifier) {
    String uri = provider.getAuthorizationUri();
    return uri
        + (URI.create(uri).getRawQuery() == null ? "?" : "&")
        + "response_type=code&scope=openid&client_id="
        + encode(provider.getClientId())
        + "&redirect_uri="
        + encode(provider.getRedirectUri())
        + "&state="
        + encode(state)
        + "&nonce="
        + encode(nonce)
        + "&code_challenge_method=S256&code_challenge="
        + encode(pkce(verifier))
        + "&prompt=select_account";
  }

  /** 令牌/JWKS 只从部署白名单地址读取，拒绝重定向和超大响应；提供方失败不回显 code/密钥/正文。 */
  public String exchange(
      IdentityProperties.Provider provider, String code, String nonce, String verifier) {
    try {
      String body =
          "grant_type=authorization_code&code="
              + encode(code)
              + "&redirect_uri="
              + encode(provider.getRedirectUri())
              + "&code_verifier="
              + encode(verifier);
      var request =
          HttpRequest.newBuilder(URI.create(provider.getTokenUri()))
              .timeout(Duration.ofSeconds(10))
              .header("Content-Type", "application/x-www-form-urlencoded")
              .header("Accept", "application/json");
      if ("client_secret_post".equals(provider.getClientAuthentication()))
        body +=
            "&client_id="
                + encode(provider.getClientId())
                + "&client_secret="
                + encode(provider.getClientSecret());
      else
        request.header(
            "Authorization",
            "Basic "
                + Base64.getEncoder()
                    .encodeToString(
                        (encode(provider.getClientId()) + ":" + encode(provider.getClientSecret()))
                            .getBytes(StandardCharsets.US_ASCII)));
      Map<String, Object> response =
          json.readValue(
              fetch(request.POST(HttpRequest.BodyPublishers.ofString(body)).build()),
              new TypeReference<>() {});
      if (!(response.get("id_token") instanceof String idToken) || idToken.length() > 32000)
        throw rejected();
      String accessToken = response.get("access_token") instanceof String value ? value : null;
      String keys =
          fetch(
              HttpRequest.newBuilder(URI.create(provider.getJwksUri()))
                  .timeout(Duration.ofSeconds(10))
                  .GET()
                  .build());
      return verify(provider, idToken, nonce, accessToken, JWKSet.parse(keys));
    } catch (BusinessException failure) {
      throw failure;
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw rejected();
    } catch (Exception failure) {
      throw rejected();
    }
  }

  /** 验签与声明校验独立可测；不因 JWKS 中的 alg、JWT 的 jku/x5u 或 kid 指定新的取钥地址。 */
  public String verify(
      IdentityProperties.Provider provider,
      String idToken,
      String nonce,
      String accessToken,
      JWKSet keys) {
    try {
      SignedJWT token = SignedJWT.parse(idToken);
      JWSAlgorithm algorithm = token.getHeader().getAlgorithm();
      if ((!JWSAlgorithm.RS256.equals(algorithm) && !JWSAlgorithm.ES256.equals(algorithm))
          || token.getHeader().getJWKURL() != null
          || token.getHeader().getX509CertURL() != null
          || token.getHeader().getJWK() != null
          || (token.getHeader().getCriticalParams() != null
              && !token.getHeader().getCriticalParams().isEmpty())) throw rejected();
      boolean verified = false;
      for (JWK key : keys.getKeys()) {
        if (key.isPrivate()
            || (key.getKeyUse() != null && !KeyUse.SIGNATURE.equals(key.getKeyUse()))
            || (key.getAlgorithm() != null && !algorithm.equals(key.getAlgorithm()))
            || (token.getHeader().getKeyID() != null
                && !token.getHeader().getKeyID().equals(key.getKeyID()))) continue;
        if (JWSAlgorithm.RS256.equals(algorithm) && key instanceof RSAKey rsa && rsa.size() >= 2048)
          verified |= token.verify(new RSASSAVerifier(rsa));
        if (JWSAlgorithm.ES256.equals(algorithm)
            && key instanceof ECKey ec
            && com.nimbusds.jose.jwk.Curve.P_256.equals(ec.getCurve()))
          verified |= token.verify(new ECDSAVerifier(ec));
      }
      if (!verified) throw rejected();
      JWTClaimsSet claims = token.getJWTClaimsSet();
      Instant now = clock.instant();
      if (!provider.getIssuer().equals(claims.getIssuer())
          || claims.getSubject() == null
          || claims.getSubject().isBlank()
          || claims.getSubject().length() > 255
          || claims.getAudience() == null
          || !claims.getAudience().contains(provider.getClientId())
          || claims.getExpirationTime() == null
          || !claims.getExpirationTime().toInstant().isAfter(now.minusSeconds(30))
          || claims.getIssueTime() == null
          || claims.getIssueTime().toInstant().isAfter(now.plusSeconds(60))
          || claims.getIssueTime().toInstant().isBefore(now.minusSeconds(86400))
          || (claims.getNotBeforeTime() != null
              && claims.getNotBeforeTime().toInstant().isAfter(now.plusSeconds(30)))
          || !constant(nonce, claims.getStringClaim("nonce"))) throw rejected();
      String azp = claims.getStringClaim("azp");
      if ((claims.getAudience().size() > 1 || azp != null) && !provider.getClientId().equals(azp))
        throw rejected();
      String atHash = claims.getStringClaim("at_hash");
      if (atHash != null && (accessToken == null || !constant(atHash, halfHash(accessToken))))
        throw rejected();
      return claims.getSubject();
    } catch (Exception failure) {
      throw rejected();
    }
  }

  /** S256 仅散列 ASCII verifier，不使用 plain 降级；值始终是独立随机的 43 字符。 */
  public static String pkce(String verifier) {
    try {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(
              MessageDigest.getInstance("SHA-256")
                  .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    } catch (java.security.NoSuchAlgorithmException failure) {
      throw new IllegalStateException("PKCE 算法不可用");
    }
  }

  private String fetch(HttpRequest request) throws Exception {
    var pending = http.sendAsync(request, info -> new LimitedBody());
    try {
      HttpResponse<byte[]> response = pending.get(12, TimeUnit.SECONDS);
      if (response.statusCode() != 200) throw rejected();
      return new String(response.body(), StandardCharsets.UTF_8);
    } finally {
      if (!pending.isDone()) pending.cancel(true);
    }
  }

  /** 边接收边限制 1 MB；超大流立即取消，不先分配整个不可信响应，再事后检查大小。 */
  private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final CompletableFuture<byte[]> completed = new CompletableFuture<>();
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private Flow.Subscription subscription;

    @Override
    public CompletionStage<byte[]> getBody() {
      return completed;
    }

    @Override
    public void onSubscribe(Flow.Subscription value) {
      subscription = value;
      value.request(1);
    }

    @Override
    public void onNext(List<ByteBuffer> buffers) {
      int length = buffers.stream().mapToInt(ByteBuffer::remaining).sum();
      if (length > 1048576 - output.size()) {
        subscription.cancel();
        completed.completeExceptionally(rejected());
        return;
      }
      for (ByteBuffer buffer : buffers) {
        byte[] part = new byte[buffer.remaining()];
        buffer.get(part);
        output.writeBytes(part);
      }
      subscription.request(1);
    }

    @Override
    public void onError(Throwable failure) {
      completed.completeExceptionally(failure);
    }

    @Override
    public void onComplete() {
      completed.complete(output.toByteArray());
    }
  }

  private static String halfHash(String token) throws Exception {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(
            java.util.Arrays.copyOf(
                MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.US_ASCII)),
                16));
  }

  private static boolean constant(String expected, String actual) {
    return expected != null
        && actual != null
        && MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private static BusinessException rejected() {
    return new BusinessException("企业身份验证失败，请重新登录或联系管理员检查提供方配置");
  }
}
